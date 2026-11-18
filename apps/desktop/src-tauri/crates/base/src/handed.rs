pub const LINK_FLAG: &str = "--url";

pub const BACKGROUND_FLAG: &str = "--background";

pub fn for_a_link<A: AsRef<std::ffi::OsStr>>(args: &[A]) -> bool {
    args.iter().skip(1).any(|one| one.as_ref() == LINK_FLAG)
}
