#import <UIKit/UIKit.h>

extern "C" void JH_PlayHaptic(int style)
{
    dispatch_async(dispatch_get_main_queue(), ^{
        if (@available(iOS 10.0, *))
        {
            UIImpactFeedbackStyle impactStyle = UIImpactFeedbackStyleLight;
            if (style == 1) impactStyle = UIImpactFeedbackStyleMedium;
            else if (style >= 2) impactStyle = UIImpactFeedbackStyleHeavy;
            UIImpactFeedbackGenerator *generator =
                [[UIImpactFeedbackGenerator alloc] initWithStyle:impactStyle];
            [generator prepare];
            [generator impactOccurred];
        }
    });
}
