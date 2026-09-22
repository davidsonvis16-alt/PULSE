import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';

/**
 * Where a tapped alert lands.
 *
 * The server sends either a route inside the app (an award page) or the
 * address of an article. A tap should go straight to the thing it was about,
 * including when the alert is what opened the app from cold.
 */

interface AlertData {
  route?: string;
  url?: string;
  tab?: string;
}

/** Shows an alert while the app is in the foreground, rather than swallowing it. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function useNotificationRouting() {
  const router = useRouter();

  useEffect(() => {
    const open = (data: AlertData | undefined) => {
      if (!data) return;
      if (data.route) {
        router.push(data.route as never);
        return;
      }
      if (data.url) {
        void WebBrowser.openBrowserAsync(data.url).catch(() => {});
        return;
      }
      if (data.tab === 'news') router.push('/discover?tab=news');
    };

    // A tap while the app is running, or in the background.
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data as AlertData);
    });

    // A tap that started the app from cold.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) open(response.notification.request.content.data as AlertData);
      })
      .catch(() => {});

    return () => subscription.remove();
  }, [router]);
}
