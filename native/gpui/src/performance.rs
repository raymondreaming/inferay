//! Paired release measurements for native rendering regressions.
use std::time::Instant;

pub fn compare(workload: &str, mut run: impl FnMut(bool)) {
    assert!(
        !std::hint::black_box(cfg!(debug_assertions)),
        "run benchmarks with --release"
    );
    for _ in 0..2 {
        run(false);
        run(true);
    }
    let mut samples = [Vec::new(), Vec::new()];
    for sample in 0..12 {
        for candidate in [sample % 2 == 0, sample % 2 != 0] {
            let start = Instant::now();
            run(candidate);
            samples[usize::from(candidate)].push(start.elapsed().as_secs_f64() * 1_000_000.);
        }
    }
    for times in &mut samples {
        times.sort_by(f64::total_cmp);
    }
    println!(
        "{}",
        serde_json::json!({
            "workload": workload, "samples":12,
            "before_p50_us":samples[0][6], "before_p95_us":samples[0][11],
            "after_p50_us":samples[1][6], "after_p95_us":samples[1][11],
            "speedup":samples[0][6] / samples[1][6],
        })
    );
}
