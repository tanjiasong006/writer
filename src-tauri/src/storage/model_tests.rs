//! 模型测试：随机的长序列结构操作（插入、移动、删除子树）与正文编辑，每批后保存，
//! 部分保存在随机的文件系统操作处注入崩溃。每次重新打开后与内存模型逐章节对照：
//! ChapterId 对应的正文不串章、文件名等于按编号推导的名字、content/ 中没有多余文件、没有事务残留。

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde_json::{json, Value};
use tempfile::TempDir;

use super::fs::faulty::FaultyFs;
use super::fs::RealFs;
use super::*;

/// 可复现的伪随机数（xorshift64*），不引入依赖。
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }
}

#[derive(Clone, Debug)]
struct Node {
    id: String,
    children: Vec<Node>,
}

/// 文档模型：章节树 + ChapterId → 正文。
#[derive(Clone, Debug)]
struct Model {
    tree: Vec<Node>,
    contents: BTreeMap<String, String>,
    next_id: usize,
}

impl Model {
    /// ChapterId → 按编号推导的文件名（与前端 contentFileName 规则一致）。
    fn files(&self) -> BTreeMap<String, String> {
        fn visit(nodes: &[Node], prefix: &[usize], out: &mut BTreeMap<String, String>) {
            for (index, node) in nodes.iter().enumerate() {
                let mut number = prefix.to_vec();
                number.push(index + 1);
                let name = number
                    .iter()
                    .map(usize::to_string)
                    .collect::<Vec<_>>()
                    .join("_");
                out.insert(node.id.clone(), format!("ch_{name}.md"));
                visit(&node.children, &number, out);
            }
        }
        let mut out = BTreeMap::new();
        visit(&self.tree, &[], &mut out);
        out
    }

    fn manifest(&self) -> Value {
        fn chapters(nodes: &[Node]) -> Value {
            Value::Array(
                nodes
                    .iter()
                    .map(|n| json!({ "id": n.id, "title": n.id, "children": chapters(&n.children) }))
                    .collect(),
            )
        }
        json!({
            "format": "writer-project",
            "version": 1,
            "title": "模型",
            "chapters": chapters(&self.tree),
            "files": self.files(),
        })
    }

    /// 所有节点的路径（从根开始的下标序列）。
    fn paths(&self) -> Vec<Vec<usize>> {
        fn visit(nodes: &[Node], prefix: &mut Vec<usize>, out: &mut Vec<Vec<usize>>) {
            for (index, node) in nodes.iter().enumerate() {
                prefix.push(index);
                out.push(prefix.clone());
                visit(&node.children, prefix, out);
                prefix.pop();
            }
        }
        let mut out = Vec::new();
        visit(&self.tree, &mut Vec::new(), &mut out);
        out
    }

    fn list_mut(&mut self, parent: &[usize]) -> &mut Vec<Node> {
        let mut list = &mut self.tree;
        for &index in parent {
            list = &mut list[index].children;
        }
        list
    }

    fn node(&self, path: &[usize]) -> &Node {
        let mut list = &self.tree;
        for &index in &path[..path.len() - 1] {
            list = &list[index].children;
        }
        &list[path[path.len() - 1]]
    }

    fn insert(&mut self, rng: &mut Rng) {
        let id = format!("c{}", self.next_id);
        self.next_id += 1;
        let paths = self.paths();
        let parent = if paths.is_empty() || rng.chance(30) {
            Vec::new()
        } else {
            paths[rng.below(paths.len())].clone()
        };
        let list = self.list_mut(&parent);
        let index = rng.below(list.len() + 1);
        list.insert(
            index,
            Node {
                id: id.clone(),
                children: Vec::new(),
            },
        );
        self.contents.insert(id, random_text(rng));
    }

    fn remove(&mut self, rng: &mut Rng) {
        let paths = self.paths();
        if paths.is_empty() {
            return;
        }
        let path = paths[rng.below(paths.len())].clone();
        let (last, parent) = path.split_last().unwrap();
        let removed = self.list_mut(parent).remove(*last);
        let mut stack = vec![removed];
        while let Some(node) = stack.pop() {
            self.contents.remove(&node.id);
            stack.extend(node.children);
        }
    }

    /// 把随机章节（连同子树）移到随机位置；目标不能在自身子树内。
    fn relocate(&mut self, rng: &mut Rng) {
        let paths = self.paths();
        if paths.len() < 2 {
            return;
        }
        let path = paths[rng.below(paths.len())].clone();
        let (last, parent) = path.split_last().unwrap();
        let moving = self.list_mut(parent).remove(*last);
        let targets: Vec<Vec<usize>> = std::iter::once(Vec::new())
            .chain(self.paths())
            .collect();
        let target = targets[rng.below(targets.len())].clone();
        let list = self.list_mut(&target);
        let index = rng.below(list.len() + 1);
        list.insert(index, moving);
    }

    fn edit(&mut self, rng: &mut Rng) -> Option<String> {
        let paths = self.paths();
        if paths.is_empty() {
            return None;
        }
        let id = self.node(&paths[rng.below(paths.len())]).id.clone();
        self.contents.insert(id.clone(), random_text(rng));
        Some(id)
    }
}

fn random_text(rng: &mut Rng) -> String {
    const PIECES: [&str; 8] = [
        "",
        "第一段。\n\n第二段",
        "line\r\nwindows\r\n",
        "\u{feff}带 BOM 的正文",
        "emoji 📚 与 “引号”",
        "# 标题\n\n- 列表\n- 项",
        "   ",
        "ch_1.md 这段文字看起来像文件名",
    ];
    let piece = PIECES[rng.below(PIECES.len())];
    format!("{piece}#{}", rng.next() % 10_000)
}

/// 磁盘状态必须与模型逐项一致。
fn assert_disk_matches(root: &Path, model: &Model, context: &str) {
    let opened = open_project(&RealFs, root)
        .unwrap_or_else(|e| panic!("{context}: reopen failed: {e:?}"));
    assert_eq!(opened.manifest, model.manifest(), "{context}: manifest");
    assert_eq!(opened.contents, model.contents, "{context}: 正文与 ChapterId 对应");
    let files = model.files();
    for (id, file) in &files {
        let bytes = fs::read(root.join("content").join(file)).unwrap();
        assert_eq!(
            String::from_utf8(bytes).unwrap(),
            model.contents[id],
            "{context}: {file} 应是 {id} 的正文"
        );
    }
    let mut expected: Vec<String> = files.into_values().collect();
    expected.sort();
    let mut actual = RealFs
        .list_files(&root.join("content"))
        .unwrap_or_default();
    actual.sort();
    assert_eq!(actual, expected, "{context}: content/ 中不应有多余文件");
    assert!(!root.join(".writer/journal.json").exists(), "{context}");
    assert!(!root.join(".writer/staging").exists(), "{context}");
}

fn run(seed: u64, steps: usize) {
    let mut rng = Rng(seed);
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("模型 项目");

    let mut saved = Model {
        tree: Vec::new(),
        contents: BTreeMap::new(),
        next_id: 0,
    };
    create_project(
        &RealFs,
        &root,
        &SaveRequest {
            manifest: saved.manifest(),
            contents: BTreeMap::new(),
        },
    )
    .unwrap();

    for step in 0..steps {
        let mut next = saved.clone();
        for _ in 0..1 + rng.below(4) {
            match rng.below(10) {
                0..=2 => next.insert(&mut rng),
                3 => next.remove(&mut rng),
                4..=7 => next.relocate(&mut rng),
                _ => {
                    next.edit(&mut rng);
                }
            }
        }
        // 与前端相同：只携带正文相对上次成功保存有变化的章节（含新章节）。
        let changed: BTreeMap<String, String> = next
            .contents
            .iter()
            .filter(|(id, text)| saved.contents.get(*id) != Some(*text))
            .map(|(id, text)| (id.clone(), text.clone()))
            .collect();
        let request = SaveRequest {
            manifest: next.manifest(),
            contents: changed,
        };
        let context = format!("seed={seed} step={step}");

        if rng.chance(25) {
            // 在随机位置崩溃：磁盘必须恰为旧状态或新状态，之后可以继续工作。
            let faulty = FaultyFs::failing_at(rng.below(60));
            let committed = save_project(&faulty, &root, &request).is_ok()
                || root.join(".writer/journal.json").exists();
            let opened = open_project(&RealFs, &root)
                .unwrap_or_else(|e| panic!("{context}: reopen after crash failed: {e:?}"));
            let is_new = opened.manifest == next.manifest() && opened.contents == next.contents;
            let is_old = opened.manifest == saved.manifest() && opened.contents == saved.contents;
            assert!(is_new || is_old, "{context}: 崩溃后既不是旧状态也不是新状态");
            assert!(!committed || is_new, "{context}: 已提交的保存必须前滚");
            if is_new {
                saved = next;
            }
            assert_disk_matches(&root, &saved, &context);
            continue;
        }

        save_project(&RealFs, &root, &request)
            .unwrap_or_else(|e| panic!("{context}: save failed: {e:?}"));
        saved = next;
        assert_disk_matches(&root, &saved, &context);
    }
}

#[test]
fn random_structure_edits_and_crashes_never_mix_up_chapters() {
    for seed in [1, 7, 42, 2024, 0x5eed] {
        run(seed, 40);
    }
}
