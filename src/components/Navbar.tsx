import { NotificationBell } from "@/components/notification-bell";
import { getRecruiterNotifications } from "@/lib/actions/notifications";

export default async function Navbar() {
  // Authed dashboard chrome — fail soft to an empty bell if the lookup hiccups.
  const notifications = await getRecruiterNotifications().catch(() => []);

  return (
    <header className="h-20 border-b border-[#E5E7EB] bg-[#FFFFFF] flex items-center justify-end px-8 z-10 sticky top-0">
      <NotificationBell notifications={notifications} />
    </header>
  );
}
