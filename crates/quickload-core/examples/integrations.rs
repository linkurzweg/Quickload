/// Measure only the additional local provider readers without saving data, artwork requests or game launches.
fn main() {
    #[cfg(windows)]
    {
        let start = std::time::Instant::now();
        let mut report = quickload_core::discovery::ScanReport::default();
        quickload_core::integrations::scan(&mut report);
        let elapsed = start.elapsed();
        report.games.sort_by(|a, b| a.id.cmp(&b.id));
        report.games.dedup_by(|a, b| a.id == b.id);
        println!(
            "Additional integrations: {} games, {:.2} ms, {} warnings",
            report.games.len(),
            elapsed.as_secs_f64() * 1000.0,
            report.warnings.len()
        );
        for game in report.games {
            println!("{} | {}", game.id, game.title);
        }
        for warning in report.warnings {
            eprintln!("{warning}");
        }
    }
    #[cfg(not(windows))]
    println!("These local registry integrations are Windows-only.");
}
