export async function GET() {
  const clientId = process.env.NAVER_MAP_CLIENT_ID?.trim() ?? "";

  return Response.json(
    {
      enabled: Boolean(clientId),
      clientId: clientId || null,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
