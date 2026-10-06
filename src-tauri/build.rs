fn main() {
    // MSVC 静态运行时库（libcmt、libvcruntime）引用了微软构建机上的 PDB，交叉编译时这些 PDB 不存在，
    // 链接器会为每个目标文件报一条无害的 LNK4099，淹没真正的告警。
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg=/IGNORE:4099");
    }
    tauri_build::build()
}
