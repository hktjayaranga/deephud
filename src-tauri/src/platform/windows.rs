use std::mem::size_of;
use windows_sys::Win32::{
    System::SystemInformation::GetTickCount64,
    UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
};

pub fn system_idle_seconds() -> Result<u64, String> {
    let mut input = LASTINPUTINFO {
        cbSize: size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // SAFETY: Windows writes to a correctly sized LASTINPUTINFO value.
    if unsafe { GetLastInputInfo(&mut input) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    // LASTINPUTINFO uses the low 32 bits of the system tick count. Wrapping
    // subtraction handles its roughly 49-day rollover correctly.
    let now = unsafe { GetTickCount64() } as u32;
    Ok(u64::from(now.wrapping_sub(input.dwTime)) / 1_000)
}

pub fn monotonic_millis() -> Result<u64, String> {
    // GetTickCount64 is monotonic and includes time spent suspended.
    Ok(unsafe { GetTickCount64() })
}
