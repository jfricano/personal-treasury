#[cfg(target_os = "macos")]
pub fn observe(app: tauri::AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::{NSWorkspace, NSWorkspaceWillSleepNotification};
    use objc2_foundation::{NSDistributedNotificationCenter, NSNotification, NSString};
    use std::ptr::NonNull;
    use tauri::Emitter;
    let sleep_app = app.clone();
    let sleep = RcBlock::new(move |_: NonNull<NSNotification>| {
        let _ = sleep_app.emit("pt-lock", ());
    });
    let locked = RcBlock::new(move |_: NonNull<NSNotification>| {
        let _ = app.emit("pt-lock", ());
    });
    // The blocks capture only thread-safe application handles, and observers live for the app lifetime.
    unsafe {
        let token = NSWorkspace::sharedWorkspace()
            .notificationCenter()
            .addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceWillSleepNotification),
                None,
                None,
                &sleep,
            );
        std::mem::forget(token);
        let name = NSString::from_str("com.apple.screenIsLocked");
        let token = NSDistributedNotificationCenter::defaultCenter()
            .addObserverForName_object_queue_usingBlock(Some(&name), None, None, &locked);
        std::mem::forget(token);
    }
}
#[cfg(not(target_os = "macos"))]
pub fn observe(_: tauri::AppHandle) {}
