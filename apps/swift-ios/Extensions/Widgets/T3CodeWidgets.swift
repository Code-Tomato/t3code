import SwiftUI
import WidgetKit

@main
struct T3CodeWidgetBundle: WidgetBundle {
    var body: some Widget {
        T3TaskLiveActivity()
        T3RecentTasksWidget()
        subscriptionUsageWidget
    }

    // WidgetBundleBuilder supports availability checks, but not if/else branches.
    private var subscriptionUsageWidget: some Widget {
        if #available(iOS 17.0, *) {
            return WidgetBundleBuilder.buildOptional(
                WidgetBundleBuilder.buildLimitedAvailability(T3SubscriptionUsageWidget())
            )
        } else {
            return WidgetBundleBuilder.buildOptional(
                WidgetBundleBuilder.buildLimitedAvailability(T3StaticSubscriptionUsageWidget())
            )
        }
    }
}
