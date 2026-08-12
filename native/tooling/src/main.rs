mod prepare_release_app;
mod release;

fn main() {
    let mut arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let result = match arguments.first().map(String::as_str) {
        Some("prepare-release-app") => {
            arguments.remove(0);
            prepare_release_app::run(&arguments)
        }
        Some("release") => {
            arguments.remove(0);
            release::run(&arguments)
        }
        _ => Err("Usage: inferay-tooling <prepare-release-app|release> [arguments]".into()),
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
