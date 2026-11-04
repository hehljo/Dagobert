#import "SimulatorBiometrics.h"
#import <TargetConditionals.h>
#import <notify.h>

// Simulator-only hardware inputs; never compiled into the app target.
uint32_t DGEnrollSimulatorBiometrics(void) {
#if TARGET_OS_SIMULATOR
    int token = 0;
    uint32_t result = notify_register_check("com.apple.BiometricKit.enrollmentChanged", &token);
    if (result != NOTIFY_STATUS_OK) return result;
    result = notify_set_state(token, 1);
    if (result == NOTIFY_STATUS_OK) result = notify_post("com.apple.BiometricKit.enrollmentChanged");
    notify_cancel(token);
    return result;
#else
    return UINT32_MAX;
#endif
}

uint32_t DGSendSimulatorBiometric(BOOL matching) {
#if TARGET_OS_SIMULATOR
    uint32_t result = notify_post(matching ? "com.apple.BiometricKit_Sim.pearl.match" : "com.apple.BiometricKit_Sim.pearl.nomatch");
    if (result != NOTIFY_STATUS_OK) return result;
    return notify_post(matching ? "com.apple.BiometricKit_Sim.fingerTouch.match" : "com.apple.BiometricKit_Sim.fingerTouch.nomatch");
#else
    return UINT32_MAX;
#endif
}
