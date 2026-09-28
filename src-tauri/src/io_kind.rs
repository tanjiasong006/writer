//! 文件系统错误的分类：前端据此给出用户能理解的说明（没有权限、磁盘已满……），
//! 而不是直接显示操作系统的英文原文。

use std::io;

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum IoKind {
    PermissionDenied,
    ReadOnly,
    DiskFull,
    NotFound,
    /// 文件被其他程序占用（常见于 Windows）。
    Busy,
    Other,
}

pub fn classify(error: &io::Error) -> IoKind {
    match error.kind() {
        io::ErrorKind::PermissionDenied => IoKind::PermissionDenied,
        io::ErrorKind::ReadOnlyFilesystem => IoKind::ReadOnly,
        io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded => IoKind::DiskFull,
        io::ErrorKind::NotFound => IoKind::NotFound,
        io::ErrorKind::ResourceBusy | io::ErrorKind::ExecutableFileBusy => IoKind::Busy,
        _ => classify_raw(error.raw_os_error()),
    }
}

#[cfg(windows)]
fn classify_raw(code: Option<i32>) -> IoKind {
    // ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION：文件被其他程序打开；ERROR_DISK_FULL。
    match code {
        Some(32 | 33) => IoKind::Busy,
        Some(112) => IoKind::DiskFull,
        _ => IoKind::Other,
    }
}

#[cfg(not(windows))]
fn classify_raw(_code: Option<i32>) -> IoKind {
    IoKind::Other
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_failures_are_classified() {
        let cases = [
            (io::ErrorKind::PermissionDenied, IoKind::PermissionDenied),
            (io::ErrorKind::ReadOnlyFilesystem, IoKind::ReadOnly),
            (io::ErrorKind::StorageFull, IoKind::DiskFull),
            (io::ErrorKind::NotFound, IoKind::NotFound),
            (io::ErrorKind::ResourceBusy, IoKind::Busy),
            (io::ErrorKind::InvalidData, IoKind::Other),
        ];
        for (kind, expected) in cases {
            assert_eq!(classify(&io::Error::from(kind)), expected, "{kind:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn os_errors_map_to_the_same_kinds() {
        // EACCES、EROFS、ENOSPC 是只读项目、只读磁盘、磁盘已满时实际得到的错误。
        for (code, expected) in [(13, IoKind::PermissionDenied), (30, IoKind::ReadOnly), (28, IoKind::DiskFull)] {
            assert_eq!(classify(&io::Error::from_raw_os_error(code)), expected, "errno {code}");
        }
    }
}
