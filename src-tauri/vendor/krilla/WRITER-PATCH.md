# Writer 的 PNG 无损编码补丁

来源：crates.io `krilla 0.8.2`，原包 checksum
`27da593198b20eeba65caeb73c2bbeec3e53ab08fa549898312ce81c4fce5e33`。
源码、Cargo metadata、ICC 文件与 examples 来自本机已锁定的发布包；许可证与 NOTICE 来自上游仓库。
上游：https://github.com/LaurenzV/krilla 。

## 补丁范围

- `src/graphics/image.rs`：`Image::from_custom` 的 8-bit RGB / 灰度通道以及对应 alpha 通道，
  使用 PNG 逐行预测后压缩；写出对应的 PDF `DecodeParms`。
- `src/graphics/png_predictor.rs`：复用现有 `png` crate 的自适应过滤与 DEFLATE level 3 压缩，
  从**自行编码**的 PNG 取出 IDAT zlib 数据。此函数不解析来自用户的 PNG 文件。
  PDF 使用 `FlateDecode`、`Predictor 15`、对应的 Colors / Columns / BitsPerComponent。
  ASCII PDF 的 DecodeParms 与 `[ASCIIHexDecode, FlateDecode]` 顺序对应。
- 其余图片入口、JPEG 字节、16-bit / CMYK custom image 路径、ICC、色彩空间、透明通道数据、
  图片尺寸、结构标签、字体及页面内容沿用上游实现。

Writer 经 Typst 使用 `from_custom` 输出非 JPEG 图片；PNG 的解码、颜色类型转换与超大图缩小
仍由既有路径完成。本补丁只改变最终通道的无损编码，不调整像素或排版。

## 验证与升级

- `cargo test --lib export::`：包含 PNG 体积回归、逐通道 PNG 解码像素往返、DecodeParms
  顺序与异常输入测试；补丁模块在 Writer 测试中直接编译，无需单独维护 vendor workspace。
- 手动基准：`cargo test --lib measure_pdf_image_formats -- --ignored --nocapture`。
- 修改补丁后用独立 PDF 阅读器检查 RGB、灰度、alpha、palette、interlaced、ICC 和 16-bit
  来源图片，并对比现有 PDF 的解码像素、软遮罩、文字、书签、分页与页面渲染。
- 升级 Typst / krilla 时，先检查上游是否已有等价实现；若有则移除 `[patch.crates-io]`
  与本地源码，再运行上述回归与基准；否则按新版本重新应用这两处修改。

除新增模块外，上游源码只修改 `src/graphics/image.rs`。不修改全局 Cargo registry 缓存。
