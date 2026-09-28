use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tempfile::TempDir;

use super::fs::faulty::FaultyFs;
use super::fs::RealFs;
use super::*;

/// 一个项目的逻辑状态：标题、ChapterId → 文件名、ChapterId → 正文。
#[derive(Clone, Debug)]
struct State {
    title: &'static str,
    files: Vec<(&'static str, String)>,
    contents: Vec<(&'static str, String)>,
}

impl State {
    fn new(title: &'static str, chapters: &[(&'static str, &str, &str)]) -> Self {
        State {
            title,
            files: chapters
                .iter()
                .map(|(id, file, _)| (*id, (*file).to_owned()))
                .collect(),
            contents: chapters
                .iter()
                .map(|(id, _, text)| (*id, (*text).to_owned()))
                .collect(),
        }
    }

    fn manifest(&self) -> Value {
        let files: serde_json::Map<String, Value> = self
            .files
            .iter()
            .map(|(id, file)| ((*id).to_owned(), json!(file)))
            .collect();
        json!({
            "format": "writer-project",
            "version": 1,
            "title": self.title,
            "chapters": [],
            "files": files,
        })
    }

    fn contents_map(&self) -> BTreeMap<String, String> {
        self.contents
            .iter()
            .map(|(id, text)| ((*id).to_owned(), text.clone()))
            .collect()
    }

    fn file_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.files.iter().map(|(_, f)| f.clone()).collect();
        names.sort();
        names
    }

    /// 直接在磁盘上写出这个状态（绕过事务），作为测试的初始项目。
    fn write_to(&self, root: &Path) {
        fs::create_dir_all(root.join("content")).unwrap();
        fs::write(
            root.join("writer.json"),
            serde_json::to_vec_pretty(&self.manifest()).unwrap(),
        )
        .unwrap();
        let contents = self.contents_map();
        for (id, file) in &self.files {
            fs::write(root.join("content").join(file), &contents[*id]).unwrap();
        }
    }

    /// 保存到这个状态的请求：只携带 `changed` 中章节的正文。
    fn request(&self, changed: &[&str]) -> SaveRequest {
        let all = self.contents_map();
        SaveRequest {
            manifest: self.manifest(),
            contents: changed
                .iter()
                .map(|id| ((*id).to_owned(), all[*id].clone()))
                .collect(),
        }
    }
}

fn project_root(dir: &TempDir) -> PathBuf {
    // 中文、空格与 emoji 路径贯穿所有测试。
    dir.path().join("我的 论文 📚")
}

fn content_files(root: &Path) -> Vec<String> {
    RealFs.list_files(&root.join("content")).unwrap_or_default()
}

/// 断言磁盘上恰好是 `state`：manifest、正文、content/ 中没有多余文件、没有事务残留。
fn assert_disk_is(root: &Path, state: &State) {
    let opened = open_project(&RealFs, root).expect("project opens");
    assert_eq!(opened.manifest, state.manifest());
    assert_eq!(opened.contents, state.contents_map());
    assert_eq!(content_files(root), state.file_names());
    assert_no_transaction_leftovers(root);
}

fn assert_no_transaction_leftovers(root: &Path) {
    assert!(!root.join(".writer/journal.json").exists());
    assert!(!root.join(".writer/journal.json.tmp").exists());
    assert!(!root.join(".writer/staging").exists());
}

/// 在保存的每一个文件系统操作处注入失败（之后所有操作也失败，模拟崩溃），然后验证：
/// - 重新打开后磁盘恰好是旧状态或新状态之一；
/// - 若失败时事务已提交（journal 存在），则必须是新状态；
/// - 失败后再次保存能收敛到新状态。
fn crash_matrix(old: &State, new: &State, changed: &[&str]) {
    let mut injected_runs = 0;
    for fail_at in 0.. {
        let dir = TempDir::new().unwrap();
        let root = project_root(&dir);
        old.write_to(&root);

        let faulty = FaultyFs::failing_at(fail_at);
        let result = save_project(&faulty, &root, &new.request(changed));
        if faulty.operations() <= fail_at {
            result.expect("save succeeds without injected failure");
            assert_disk_is(&root, new);
            break;
        }
        injected_runs += 1;

        // 成功返回只可能是失败发生在事务结束后的 staging 清理（被有意忽略）。
        let committed = result.is_ok() || root.join(".writer/journal.json").exists();
        let opened = open_project(&RealFs, &root)
            .unwrap_or_else(|e| panic!("fail_at={fail_at}: reopen failed: {e:?}"));
        let is_old = opened.manifest == old.manifest() && opened.contents == old.contents_map();
        let is_new = opened.manifest == new.manifest() && opened.contents == new.contents_map();
        assert!(
            is_old || is_new,
            "fail_at={fail_at}: disk is neither old nor new state"
        );
        if committed {
            assert!(
                is_new,
                "fail_at={fail_at}: committed transaction must roll forward"
            );
        }
        let expected = if is_new { new } else { old };
        assert_eq!(
            content_files(&root),
            expected.file_names(),
            "fail_at={fail_at}"
        );
        assert_no_transaction_leftovers(&root);

        save_project(&RealFs, &root, &new.request(changed)).unwrap();
        assert_disk_is(&root, new);
    }
    assert!(injected_runs > 0);
}

#[test]
fn swap_two_files_is_crash_safe() {
    let old = State::new("论文", &[("a", "ch_1.md", "甲"), ("b", "ch_2.md", "乙")]);
    let new = State::new("论文", &[("a", "ch_2.md", "甲"), ("b", "ch_1.md", "乙")]);
    crash_matrix(&old, &new, &[]);
}

#[test]
fn moving_a_subtree_renames_every_descendant_crash_safely() {
    let old = State::new(
        "论文",
        &[
            ("a", "ch_1.md", "A"),
            ("a1", "ch_1_1.md", "A1"),
            ("a2", "ch_1_2.md", "A2"),
            ("a21", "ch_1_2_1.md", "A21"),
            ("b", "ch_2.md", "B"),
        ],
    );
    // 把 a 整棵子树移到 b 之下。
    let new = State::new(
        "论文",
        &[
            ("b", "ch_1.md", "B"),
            ("a", "ch_1_1.md", "A"),
            ("a1", "ch_1_1_1.md", "A1"),
            ("a2", "ch_1_1_2.md", "A2"),
            ("a21", "ch_1_1_2_1.md", "A21"),
        ],
    );
    crash_matrix(&old, &new, &[]);
}

#[test]
fn inserting_at_top_shifts_many_files_crash_safely() {
    let ids: Vec<&'static str> = (1..=20)
        .map(|i| &*Box::leak(format!("c{i}").into_boxed_str()))
        .collect();
    let texts: Vec<String> = (1..=20).map(|i| format!("第 {i} 章正文\n")).collect();

    let old_chapters: Vec<(&'static str, String, String)> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| (*id, format!("ch_{}.md", i + 1), texts[i].clone()))
        .collect();
    let mut new_chapters = vec![("x", "ch_1.md".to_owned(), String::new())];
    new_chapters.extend(
        ids.iter()
            .enumerate()
            .map(|(i, id)| (*id, format!("ch_{}.md", i + 2), texts[i].clone())),
    );

    let to_state = |chapters: &[(&'static str, String, String)]| State {
        title: "论文",
        files: chapters.iter().map(|(id, f, _)| (*id, f.clone())).collect(),
        contents: chapters.iter().map(|(id, _, t)| (*id, t.clone())).collect(),
    };
    crash_matrix(&to_state(&old_chapters), &to_state(&new_chapters), &["x"]);
}

#[test]
fn deleting_a_subtree_and_editing_is_crash_safe() {
    let old = State::new(
        "论文",
        &[
            ("a", "ch_1.md", "A"),
            ("a1", "ch_1_1.md", "A1"),
            ("b", "ch_2.md", "B"),
        ],
    );
    let new = State::new("论文（修订）", &[("b", "ch_1.md", "B 改写后")]);
    crash_matrix(&old, &new, &["b"]);
}

#[test]
fn editing_content_without_structure_change_is_crash_safe() {
    let old = State::new("论文", &[("a", "ch_1.md", "旧"), ("b", "ch_2.md", "不变")]);
    let new = State::new(
        "论文",
        &[("a", "ch_1.md", "新的正文"), ("b", "ch_2.md", "不变")],
    );
    crash_matrix(&old, &new, &["a"]);
}

#[test]
fn unchanged_files_are_not_touched() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    let old = State::new("论文", &[("a", "ch_1.md", "A"), ("b", "ch_2.md", "B")]);
    old.write_to(&root);
    let before = fs::metadata(root.join("content/ch_2.md"))
        .unwrap()
        .modified()
        .unwrap();

    let new = State::new("论文", &[("a", "ch_1.md", "A2"), ("b", "ch_2.md", "B")]);
    save_project(&RealFs, &root, &new.request(&["a"])).unwrap();

    let after = fs::metadata(root.join("content/ch_2.md"))
        .unwrap()
        .modified()
        .unwrap();
    assert_eq!(before, after);
    assert_disk_is(&root, &new);
}

#[test]
fn renaming_preserves_bytes_exactly() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    let raw = "\u{feff}# 标题\r\n\r\n正文  \r\n\t缩进\r\n";
    let old = State::new("论文", &[("a", "ch_1.md", raw), ("b", "ch_2.md", "B")]);
    old.write_to(&root);

    let new = State::new("论文", &[("b", "ch_1.md", "B"), ("a", "ch_2.md", raw)]);
    save_project(&RealFs, &root, &new.request(&[])).unwrap();

    assert_eq!(
        fs::read(root.join("content/ch_2.md")).unwrap(),
        raw.as_bytes()
    );
}

#[test]
fn orphan_file_occupying_a_target_is_preserved() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    let old = State::new("论文", &[("a", "ch_1.md", "A")]);
    old.write_to(&root);
    fs::write(root.join("content/ch_2.md"), "用户手动放入的文件").unwrap();

    let opened = open_project(&RealFs, &root).unwrap();
    assert_eq!(opened.orphan_files, vec!["ch_2.md"]);

    let new = State::new("论文", &[("a", "ch_1.md", "A"), ("n", "ch_2.md", "新章节")]);
    save_project(&RealFs, &root, &new.request(&["n"])).unwrap();

    assert_disk_is(&root, &new);
    let recovered = RealFs.list_files(&root.join(".writer/recovered")).unwrap();
    assert_eq!(recovered.len(), 1);
    assert!(recovered[0].ends_with("-ch_2.md"));
    let text = fs::read_to_string(root.join(".writer/recovered").join(&recovered[0])).unwrap();
    assert_eq!(text, "用户手动放入的文件");
}

#[test]
fn repeated_saves_are_idempotent() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    let old = State::new("论文", &[("a", "ch_1.md", "A"), ("b", "ch_2.md", "B")]);
    old.write_to(&root);
    let new = State::new("论文", &[("b", "ch_1.md", "B"), ("a", "ch_2.md", "A!")]);
    for _ in 0..3 {
        save_project(&RealFs, &root, &new.request(&["a"])).unwrap();
        assert_disk_is(&root, &new);
    }
}

#[test]
fn save_rejects_invalid_requests_without_touching_disk() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    let old = State::new("论文", &[("a", "ch_1.md", "A")]);
    old.write_to(&root);

    // 新章节没有正文。
    let new = State::new("论文", &[("a", "ch_1.md", "A"), ("n", "ch_2.md", "")]);
    assert_eq!(
        save_project(&RealFs, &root, &new.request(&[])),
        Err(StorageError::ContentRequired {
            chapter_id: "n".into()
        })
    );

    // 正文不属于任何章节。
    let mut request = old.request(&[]);
    request.contents.insert("ghost".into(), "x".into());
    assert_eq!(
        save_project(&RealFs, &root, &request),
        Err(StorageError::ContentOrphan {
            chapter_id: "ghost".into()
        })
    );

    // 文件名路径穿越、重名。
    for files in [
        json!({ "a": "../evil.md" }),
        json!({ "a": "ch_1.md", "b": "ch_1.md" }),
    ] {
        let mut manifest = old.manifest();
        manifest["files"] = files;
        let request = SaveRequest {
            manifest,
            contents: BTreeMap::new(),
        };
        assert!(matches!(
            save_project(&RealFs, &root, &request),
            Err(StorageError::ManifestInvalid { .. })
        ));
    }

    assert_disk_is(&root, &old);
    assert!(!dir.path().join("evil.md").exists());
}

#[test]
fn save_to_a_non_project_directory_fails() {
    let dir = TempDir::new().unwrap();
    let state = State::new("论文", &[]);
    assert_eq!(
        save_project(&RealFs, dir.path(), &state.request(&[])),
        Err(StorageError::NotAProject)
    );
}

#[test]
fn create_project_in_new_directory() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    let state = State::new("新文档", &[("a", "ch_1.md", "")]);
    create_project(&RealFs, &root, &state.request(&["a"])).unwrap();
    assert_disk_is(&root, &state);
}

#[test]
fn create_empty_project() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    let state = State::new("新文档", &[]);
    create_project(&RealFs, &root, &state.request(&[])).unwrap();
    assert_disk_is(&root, &state);
}

#[test]
fn create_project_refuses_non_empty_directory() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("笔记.txt"), "别覆盖我").unwrap();
    let state = State::new("新文档", &[]);
    assert_eq!(
        create_project(&RealFs, &root, &state.request(&[])),
        Err(StorageError::TargetNotEmpty)
    );
    assert_eq!(
        fs::read_to_string(root.join("笔记.txt")).unwrap(),
        "别覆盖我"
    );

    // 已有项目的目录同样拒绝。
    let other = dir.path().join("已有项目");
    state.write_to(&other);
    assert_eq!(
        create_project(&RealFs, &other, &state.request(&[])),
        Err(StorageError::TargetNotEmpty)
    );
}

#[test]
fn create_project_is_crash_safe_and_retryable() {
    let state = State::new(
        "新文档",
        &[("a", "ch_1.md", "第一章"), ("b", "ch_2.md", "")],
    );
    for fail_at in 0.. {
        let dir = TempDir::new().unwrap();
        let root = project_root(&dir);
        let faulty = FaultyFs::failing_at(fail_at);
        let result = create_project(&faulty, &root, &state.request(&["a", "b"]));
        if faulty.operations() <= fail_at {
            result.unwrap();
            assert_disk_is(&root, &state);
            break;
        }
        let committed = result.is_ok();
        match open_project(&RealFs, &root) {
            // 提交后崩溃：打开时前滚，项目完整存在。
            Ok(_) => assert_disk_is(&root, &state),
            // 提交前崩溃：目录不是项目，可以重新新建。
            Err(StorageError::NotAProject) => {
                assert!(
                    !committed,
                    "fail_at={fail_at}: reported success but no project"
                );
                create_project(&RealFs, &root, &state.request(&["a", "b"])).unwrap();
                assert_disk_is(&root, &state);
            }
            Err(error) => panic!("fail_at={fail_at}: {error:?}"),
        }
    }
}

#[test]
fn open_reports_missing_content_instead_of_guessing() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    let state = State::new("论文", &[("a", "ch_1.md", "A"), ("b", "ch_2.md", "B")]);
    state.write_to(&root);
    fs::remove_file(root.join("content/ch_2.md")).unwrap();
    assert_eq!(
        open_project(&RealFs, &root),
        Err(StorageError::ContentMissing {
            chapter_id: "b".into(),
            file: "ch_2.md".into()
        })
    );
}

#[test]
fn open_rejects_non_utf8_content() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    let state = State::new("论文", &[("a", "ch_1.md", "A")]);
    state.write_to(&root);
    fs::write(root.join("content/ch_1.md"), [0xff, 0xfe, 0x00]).unwrap();
    assert_eq!(
        open_project(&RealFs, &root),
        Err(StorageError::ContentNotUtf8 {
            chapter_id: "a".into(),
            file: "ch_1.md".into()
        })
    );
}

#[test]
fn open_rejects_broken_manifests() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    fs::create_dir_all(&root).unwrap();
    assert_eq!(open_project(&RealFs, &root), Err(StorageError::NotAProject));

    fs::write(root.join("writer.json"), "{ 不是 json").unwrap();
    assert!(matches!(
        open_project(&RealFs, &root),
        Err(StorageError::ManifestInvalid { .. })
    ));

    let mut manifest = State::new("论文", &[]).manifest();
    manifest["version"] = json!(2);
    fs::write(root.join("writer.json"), manifest.to_string()).unwrap();
    assert_eq!(
        open_project(&RealFs, &root),
        Err(StorageError::VersionUnsupported)
    );

    manifest["version"] = json!(1);
    manifest["files"] = json!({ "a": "/etc/passwd" });
    fs::write(root.join("writer.json"), manifest.to_string()).unwrap();
    assert!(matches!(
        open_project(&RealFs, &root),
        Err(StorageError::ManifestInvalid { .. })
    ));
}

#[test]
fn corrupt_or_malicious_journal_is_rejected_without_changes() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    let state = State::new("论文", &[("a", "ch_1.md", "A")]);
    state.write_to(&root);
    fs::create_dir_all(root.join(".writer")).unwrap();

    fs::write(root.join(".writer/journal.json"), "{").unwrap();
    assert_eq!(
        open_project(&RealFs, &root),
        Err(StorageError::JournalInvalid)
    );

    let evil = json!({
        "version": 1,
        "entries": [{ "staged": "0.md", "target": "../../escape.md" }],
        "deletes": [],
    });
    fs::write(root.join(".writer/journal.json"), evil.to_string()).unwrap();
    assert_eq!(
        open_project(&RealFs, &root),
        Err(StorageError::JournalInvalid)
    );
    assert_eq!(
        fs::read_to_string(root.join("content/ch_1.md")).unwrap(),
        "A"
    );
}

#[test]
fn stale_staging_without_journal_is_discarded_on_open() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    let state = State::new("论文", &[("a", "ch_1.md", "A")]);
    state.write_to(&root);
    fs::create_dir_all(root.join(".writer/staging")).unwrap();
    fs::write(root.join(".writer/staging/0.md"), "未提交的内容").unwrap();
    fs::write(root.join(".writer/journal.json.tmp"), "{\"half").unwrap();
    assert_disk_is(&root, &state);
}

#[test]
fn error_serializes_with_code_and_camel_case_fields() {
    let error = StorageError::ContentMissing {
        chapter_id: "a".into(),
        file: "ch_1.md".into(),
    };
    assert_eq!(
        serde_json::to_value(&error).unwrap(),
        json!({ "code": "content-missing", "chapterId": "a", "file": "ch_1.md" })
    );
    assert_eq!(
        serde_json::to_value(StorageError::NotAProject).unwrap(),
        json!({ "code": "not-a-project" })
    );
}

/// 与 TS 共享的格式契约：`fixtures/示例项目` 同时被 TS 的 fixture_contract 测试读取。
#[test]
fn shared_fixture_opens_and_survives_a_rename_save() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/示例项目");
    let opened = open_project(&RealFs, &fixture).unwrap();
    assert_eq!(opened.contents.len(), 3);
    assert!(opened.orphan_files.is_empty());
    assert_eq!(
        opened.contents["3f1c9a52-0000-4000-8000-000000000001"],
        "本文研究长文档写作。\n\n- 要点一\n- 要点二\n"
    );

    // 复制到临时目录，交换两个根章节后保存，验证换名与字节保留。
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    fs::create_dir_all(root.join("content")).unwrap();
    fs::copy(fixture.join("writer.json"), root.join("writer.json")).unwrap();
    for name in RealFs.list_files(&fixture.join("content")).unwrap() {
        fs::copy(
            fixture.join("content").join(&name),
            root.join("content").join(&name),
        )
        .unwrap();
    }
    let mut manifest = opened.manifest.clone();
    manifest["files"] = json!({
        "3f1c9a52-0000-4000-8000-000000000001": "ch_2.md",
        "3f1c9a52-0000-4000-8000-000000000002": "ch_1.md",
        "3f1c9a52-0000-4000-8000-000000000003": "ch_1_1.md",
    });
    let request = SaveRequest {
        manifest,
        contents: BTreeMap::new(),
    };
    save_project(&RealFs, &root, &request).unwrap();
    assert_eq!(
        fs::read(root.join("content/ch_1_1.md")).unwrap(),
        fs::read(fixture.join("content/ch_2_1.md")).unwrap()
    );
    assert_eq!(
        open_project(&RealFs, &root).unwrap().contents,
        opened.contents
    );
}

#[test]
fn ui_state_round_trip_and_is_independent_of_the_document() {
    let dir = TempDir::new().unwrap();
    let root = project_root(&dir);
    assert_eq!(
        read_ui_state(&RealFs, &root),
        Err(StorageError::NotAProject)
    );
    assert_eq!(
        write_ui_state(&RealFs, &root, "{}"),
        Err(StorageError::NotAProject)
    );

    let state = State::new("论文", &[("a", "ch_1.md", "A")]);
    state.write_to(&root);
    assert_eq!(read_ui_state(&RealFs, &root), Ok(None));

    write_ui_state(&RealFs, &root, r#"{"selectedId":"a"}"#).unwrap();
    assert_eq!(
        read_ui_state(&RealFs, &root).unwrap().as_deref(),
        Some(r#"{"selectedId":"a"}"#)
    );

    fs::write(root.join(".writer/ui-state.json"), [0xff, 0xfe]).unwrap();
    assert_eq!(read_ui_state(&RealFs, &root), Ok(None));
    assert_disk_is(&root, &state);
}
