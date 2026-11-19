import { createFileRoute } from "@tanstack/react-router";
import { ChannelDashboard } from "@/components/marketplace/channel-dashboard";

export const Route = createFileRoute("/app/ajio-dashboard")({
  component: () => <ChannelDashboard channel="ajio" title="AJIO Seller Panel" accent="#2c4152" />,
});
