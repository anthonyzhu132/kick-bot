import "dotenv/config";

const BASE = "https://discord.com/api/v10";

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} :: ${t}`);
  }
  return res;
}

async function listMembers(guildId) {
  const members = [];
  let after;
  for (let i = 0; i < 2000; i++) {
    const url = new URL(`/guilds/${guildId}/members`, BASE);
    url.searchParams.set("limit", "1000");
    if (after) url.searchParams.set("after", after);
    const res = await api(url.pathname + "?" + url.searchParams.toString());
    const page = await res.json();
    if (page.length === 0) break;
    members.push(...page);
    after = page[page.length - 1].user.id;
    if (page.length < 1000) break;
  }
  return members;
}

async function getOwnerId(guildId) {
  const res = await api(`/guilds/${guildId}`);
  const data = await res.json();
  return data.owner_id;
}

async function kick(guildId, userId, reason) {
  const res = await api(`/guilds/${guildId}/members/${userId}`, {
    method: "DELETE",
    headers: { "X-Audit-Log-Reason": encodeURIComponent(reason) },
  });
  if (res.status !== 204) throw new Error(`Kick failed for ${userId}`);
}

async function main() {
  const guildId = process.env.GUILD_ID;
  if (!process.env.DISCORD_TOKEN || !guildId)
    throw new Error("Missing DISCORD_TOKEN or GUILD_ID");

  const dry = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
  const limit = Number(process.env.LIMIT ?? "250");
  const allow = new Set(
    (process.env.ALLOWLIST_ROLE_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const ownerId = await getOwnerId(guildId);
  const members = await listMembers(guildId);

  const candidates = members
    .filter((m) => {
      if (m.user.id === ownerId) return false;
      if (m.user.bot) return false;
      if (allow.size === 0) return m.roles.length === 0;
      return !m.roles.some((r) => allow.has(r));
    })
    .slice(0, limit);

  console.log(`Found ${candidates.length} candidate(s). DRY_RUN=${dry}`);
  if (dry) {
    console.log(
      candidates
        .slice(0, 25)
        .map((m) => `${m.user.username} (${m.user.id})`)
        .join("\n")
    );
    return;
  }

  let kicked = 0;
  for (const m of candidates) {
    try {
      await kick(guildId, m.user.id, "Weekly cleanup: missing required roles");
      kicked++;
      await new Promise((r) => setTimeout(r, 250));
    } catch (e) {
      console.warn(`Failed to kick ${m.user.id}`, e);
    }
  }
  console.log(`Kicked ${kicked}/${candidates.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
