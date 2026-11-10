/// Scan local manifests without launching games; optional `--json` emits metadata for isolated diagnostics.
fn main() {
    let report = quickload_core::discovery::scan(&quickload_core::Settings::default());
    if std::env::args().any(|argument| argument == "--json") {
        println!(
            "{}",
            serde_json::to_string(&report).expect("serializable scan report")
        );
        return;
    }
    println!(
        "Installed games: {} | Scan: {} ms | Warnings: {}",
        report.games.len(),
        report.elapsed_ms,
        report.warnings.len()
    );
    for warning in report.warnings {
        eprintln!("{warning}");
    }
}
