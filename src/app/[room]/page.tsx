import VaultWorkspace from "@/components/VaultWorkspace";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ room: string }>;
}) {
  const { room } = await params;
  return <VaultWorkspace room={decodeURIComponent(room)} />;
}
