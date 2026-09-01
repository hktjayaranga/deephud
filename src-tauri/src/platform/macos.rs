use std::ffi::{c_double, c_int};

#[repr(C)]
struct MachTimebaseInfo {
    numer: u32,
    denom: u32,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state_id: u32, event_type: u32) -> c_double;
}

extern "C" {
    fn mach_continuous_time() -> u64;
    fn mach_timebase_info(info: *mut MachTimebaseInfo) -> c_int;
}

pub fn system_idle_seconds() -> Result<u64, String> {
    const COMBINED_SESSION_STATE: u32 = 0;
    const ANY_INPUT_EVENT: u32 = u32::MAX;
    // SAFETY: CoreGraphics accepts these documented enum values and has no
    // ownership requirements for this pure query.
    let seconds =
        unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT) };
    if !seconds.is_finite() || seconds < 0.0 {
        return Err("macOS idle time is unavailable".into());
    }
    Ok(seconds as u64)
}

pub fn monotonic_millis() -> Result<u64, String> {
    let mut timebase = MachTimebaseInfo { numer: 0, denom: 0 };
    // SAFETY: macOS writes the timebase values to a valid output structure.
    if unsafe { mach_timebase_info(&mut timebase) } != 0 || timebase.denom == 0 {
        return Err("unable to read the macOS monotonic clock timebase".into());
    }
    // mach_continuous_time continues across system sleep.
    let ticks = unsafe { mach_continuous_time() };
    let nanoseconds = u128::from(ticks) * u128::from(timebase.numer) / u128::from(timebase.denom);
    u64::try_from(nanoseconds / 1_000_000).map_err(|error| error.to_string())
}
