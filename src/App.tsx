import {
  BarChart3,
  Clapperboard,
  Copy,
  Download,
  FileUp,
  Film,
  Filter,
  Globe2,
  Heart,
  Languages,
  Link2,
  Loader2,
  RefreshCcw,
  Search,
  Star,
  ThumbsDown,
  UserCheck,
  UserMinus,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "./i18n";
import { readLetterboxdExport } from "./lib/letterboxd";
import { clearPersistentState, loadPersistentState, savePersistentState } from "./lib/storage";
import { buildMatches, buildRecommendations, decadeTerms, getStats, topTerms } from "./lib/taste";
import type { FilmSignal, Language, MatchResult, UserTaste } from "./types";

type Tab = "overview" | "matches" | "social" | "profile";

type SocialMember = {
  id?: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
};

type SocialData =
  | {
      available: false;
      error: string;
      message: string;
    }
  | {
      available: true;
      handle: string;
      checkedAt: string;
      source: "official-api" | "public-pages" | "browser-session" | "browser-extension";
      complete?: boolean;
      warning?: string;
      previousCheckedAt?: string;
      counts: {
        following: number;
        followers: number;
        mutuals: number;
        notFollowingBack: number;
        fans: number;
      };
      following: SocialMember[];
      followers: SocialMember[];
      mutuals: SocialMember[];
      notFollowingBack: SocialMember[];
      fans: SocialMember[];
      lostFollowers: SocialMember[];
      newFollowers: SocialMember[];
      network?: { nodes: number; edges: number; capped: boolean };
    };

type PersistentAppState = {
  users: UserTaste[];
  activeId: string;
  accountHandle: string;
  socialByHandle: Record<string, SocialData>;
};

const PERSISTENT_STATE_KEY = "app";

export default function App() {
  const [language, setLanguage] = useState<Language>("tr");
  const [tab, setTab] = useState<Tab>("overview");
  const [users, setUsers] = useState<UserTaste[]>(loadStoredUsers);
  const [activeId, setActiveId] = useState(() => localStorage.getItem("tastetwin.active") ?? "");
  const [accountHandle, setAccountHandle] = useState(() => localStorage.getItem("tastetwin.handle") ?? "");
  const [minCommon, setMinCommon] = useState(1);
  const [requireDislike, setRequireDislike] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialByHandle, setSocialByHandle] = useState<Record<string, SocialData>>(loadStoredSocial);
  const [copied, setCopied] = useState(false);
  const [storageReady, setStorageReady] = useState(false);

  const uploadedUser = users.find((user) => user.source === "upload");
  const rssUsers = users.filter((user) => user.source === "rss");
  const activeUser = users.find((user) => user.id === activeId) ?? users[0];
  const currentSocial = socialByHandle[accountHandle || activeUser?.handle || ""];
  const stats = useMemo(() => (activeUser ? getStats(activeUser) : undefined), [activeUser]);
  const matches = useMemo(() => (activeUser ? buildMatches(activeUser, users) : []), [activeUser, users]);
  const filteredMatches = matches.filter(
    (match) => match.commonCount >= minCommon && (!requireDislike || match.sharedDislikes.length > 0),
  );
  const recommendations = useMemo(() => (activeUser ? buildRecommendations(activeUser, matches) : []), [activeUser, matches]);
  const genreTerms = useMemo(() => (activeUser ? topTerms(activeUser, "genres") : []), [activeUser]);
  const directorTerms = useMemo(() => (activeUser ? topTerms(activeUser, "directors", 4) : []), [activeUser]);
  const decadeData = useMemo(() => (activeUser ? decadeTerms(activeUser) : []), [activeUser]);

  useEffect(() => {
    let cancelled = false;
    loadPersistentState<PersistentAppState>(PERSISTENT_STATE_KEY)
      .then((saved) => {
        if (cancelled || !saved) return;
        if (Array.isArray(saved.users)) setUsers(saved.users);
        if (typeof saved.activeId === "string") setActiveId(saved.activeId);
        if (typeof saved.accountHandle === "string") setAccountHandle(saved.accountHandle);
        if (saved.socialByHandle && typeof saved.socialByHandle === "object") setSocialByHandle(saved.socialByHandle);
      })
      .catch((error) => console.warn("TasteTwin IndexedDB restore failed", error))
      .finally(() => {
        if (!cancelled) setStorageReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    localStorage.setItem("tastetwin.active", activeId);
    localStorage.setItem("tastetwin.handle", accountHandle);
    savePersistentState<PersistentAppState>(PERSISTENT_STATE_KEY, {
      users,
      activeId,
      accountHandle,
      socialByHandle,
    })
      .then(() => {
        localStorage.removeItem("tastetwin.users");
        localStorage.removeItem("tastetwin.social");
      })
      .catch((error) => console.warn("TasteTwin IndexedDB save failed", error));
  }, [users, activeId, accountHandle, socialByHandle, storageReady]);

  useEffect(() => {
    async function receiveBrowserScan(event: MessageEvent) {
      if (event.origin !== "https://letterboxd.com" || event.data?.type !== "TASTETWIN_SOCIAL") return;
      const payload = socialFromBrowserMessage(event.data);
      if (!payload) return;
      const enriched = addFollowerChanges(payload.handle, payload);
      setAccountHandle(payload.handle);
      setSocialByHandle((current) => ({ ...current, [payload.handle]: enriched }));
      setTab("social");

      let target = uploadedUser;
      if (target && target.handle !== payload.handle) {
        target = { ...target, id: `upload-${payload.handle}`, handle: payload.handle, displayName: payload.handle };
      }
      if (!target) {
        const ownResponse = await fetch(`/api/letterboxd/rss?handles=${encodeURIComponent(payload.handle)}`);
        const ownPayload = await ownResponse.json();
        target = ownPayload.users?.[0] as UserTaste | undefined;
      }
      if (target) {
        setUsers((current) => [target, ...current.filter((user) => user.id !== target?.id)]);
        setActiveId(target.id);
      }
      setStatus(
        language === "tr"
          ? `Tam tarama geldi: ${payload.counts.following} takip, ${payload.counts.followers} takipci. Sosyal sekmesinden tum takip ettiklerini eslestirebilirsin.`
          : `Full scan received: ${payload.counts.following} following, ${payload.counts.followers} followers. Match all following from the Social tab.`,
      );
    }

    window.addEventListener("message", receiveBrowserScan);
    return () => window.removeEventListener("message", receiveBrowserScan);
  }, [language, uploadedUser]);

  async function handleUpload(file?: File) {
    if (!file) return;
    setStatus("");
    try {
      const imported = await readLetterboxdExport(file, accountHandle);
      const nextUsers = [imported, ...users.filter((user) => user.source !== "upload")];
      setUsers(nextUsers);
      setActiveId(imported.id);
      setTab("overview");
      setStatus(
        language === "tr"
          ? `${t(language, "uploadOk")}: ${imported.films.length} film. Hesabini baglayinca takip ettiklerin otomatik eslesir.`
          : `${t(language, "uploadOk")}: ${imported.films.length} films. Connect your handle to match your following automatically.`,
      );
    } catch (error) {
      console.error(error);
      setStatus(t(language, "uploadError"));
    }
  }

  async function fetchSocialData(source: "extension" | "public" = "extension") {
    const handle = (accountHandle || activeUser?.handle || "").trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(handle)) {
      setStatus(language === "tr" ? "Gecerli Letterboxd kullanici adini yaz" : "Enter a valid Letterboxd handle");
      return;
    }
    setAccountHandle(handle);
    setSocialLoading(true);
    setStatus("");
    try {
      const response = await fetch(`/api/letterboxd/social?handle=${encodeURIComponent(handle)}&source=${source}`);
      const payload = (await response.json()) as SocialData;
      if (!response.ok || !payload.available) {
        const errorCode = "error" in payload ? payload.error : "social_fetch_failed";
        throw new Error(errorCode);
      }
      const enriched = addFollowerChanges(handle, payload);
      setSocialByHandle((current) => {
        const existing = current[handle];
        if (
          source === "public" &&
          existing?.available &&
          existing.complete &&
          ["browser-extension", "browser-session", "official-api"].includes(existing.source)
        ) {
          return current;
        }
        return { ...current, [handle]: enriched };
      });
      setTab("social");

      let target = uploadedUser;
      if (target && target.handle !== handle) {
        target = { ...target, id: `upload-${handle}`, handle, displayName: handle };
      }
      if (!target) {
        const ownResponse = await fetch(`/api/letterboxd/rss?handles=${encodeURIComponent(handle)}`);
        const ownPayload = await ownResponse.json();
        target = ownPayload.users?.[0] as UserTaste | undefined;
      }

      if (target) {
        setUsers((current) => [target, ...current.filter((user) => user.id !== target?.id)]);
        setActiveId(target.id);
      }
      setStatus(
        language === "tr"
          ? source === "extension"
            ? `Eklentiden ${enriched.counts.following} takip, ${enriched.counts.followers} takipci alindi.`
            : enriched.complete
              ? `Halka acik kontrolde ${enriched.counts.following} takip, ${enriched.counts.followers} takipci bulundu.`
              : `Halka acik kontrol yalnizca ${enriched.counts.following}/${enriched.counts.followers} hesap gorebildi; bu kismi sonuc tam eklenti verisinin yerine gecmez.`
          : source === "extension"
            ? `Loaded ${enriched.counts.following} following and ${enriched.counts.followers} followers from the extension.`
            : `Public check found ${enriched.counts.following}/${enriched.counts.followers}; partial results never replace a complete extension scan.`,
      );
    } catch (error) {
      console.error(error);
      const extensionMissing = error instanceof Error && error.message === "extension_scan_required";
      setStatus(
        language === "tr"
          ? extensionMissing
            ? "Kayitli eklenti taramasi yok. Letterboxd profilinde eklentinin 1 numarali sosyal taramasini tamamla."
            : "Sosyal veri cekilemedi"
          : extensionMissing
            ? "No extension scan is saved. Complete scan 1 from your Letterboxd profile."
            : "Could not fetch social data",
      );
    } finally {
      setSocialLoading(false);
    }
  }

  async function useFollowingAsMatchCandidates() {
    const handle = accountHandle || activeUser?.handle || "";
    const social = socialByHandle[handle];
    if (!social?.available) return;
    const followingHandles = social.following.map((member) => member.username);
    await fetchProfilesForHandles(followingHandles);
  }

  async function useNetworkAsMatchCandidates() {
    const handle = accountHandle || activeUser?.handle || "";
    if (!handle) return;
    setLoading(true);
    setStatus("");
    try {
      const handles: string[] = [];
      let offset = 0;
      let total = 0;
      do {
        const response = await fetch(`/api/letterboxd/network?handle=${encodeURIComponent(handle)}&offset=${offset}&limit=120`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "network_not_scanned");
        handles.push(...(payload.handles as string[]));
        total = payload.total as number;
        offset = payload.nextOffset ?? total;
        setStatus(language === "tr" ? `Ag listesi aliniyor: ${handles.length}/${total}` : `Loading network list: ${handles.length}/${total}`);
      } while (offset < total);
      await fetchProfilesForHandles(handles);
    } catch (error) {
      console.error(error);
      setStatus(language === "tr" ? "Ag taramasi bulunamadi. Chrome eklentisinden ag haritasini calistir." : "Network scan not found. Run the network map in the Chrome extension.");
      setLoading(false);
    }
  }

  async function fetchProfilesForHandles(cleanHandles: string[]) {
    setLoading(true);
    setStatus("");
    try {
      const handles = [...new Set(cleanHandles.map((handle) => handle.trim().replace(/^@/, "").toLowerCase()).filter(Boolean))];
      if (!handles.length) throw new Error("handles_required");
      const fetched: UserTaste[] = [];
      let failed = 0;
      const batchSize = 60;
      for (let offset = 0; offset < handles.length; offset += batchSize) {
        const batch = handles.slice(offset, offset + batchSize);
        setStatus(
          language === "tr"
            ? `Film aktiviteleri aliniyor: ${offset}/${handles.length}`
            : `Loading film activity: ${offset}/${handles.length}`,
        );
        const response = await fetch(`/api/letterboxd/rss?handles=${encodeURIComponent(batch.join(","))}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "fetch_failed");
        fetched.push(...((payload.users ?? []) as UserTaste[]));
        failed += payload.errors?.length ?? 0;
      }
      const currentUpload = users.find((user) => user.source === "upload");
      const nextUsers = [
        ...users.filter((user) => user.source !== "rss"),
        ...fetched.filter((user) => user.id !== currentUpload?.id),
      ];
      setUsers(nextUsers);
      setActiveId(currentUpload?.id ?? fetched[0]?.id ?? "");
      setTab(currentUpload ? "matches" : "overview");
      setStatus(
        language === "tr"
          ? `${handles.length} adayin tamami denendi; ${fetched.length} kisinin film aktivitesi alindi${failed ? `, ${failed} hesap alinamadi` : ""}.`
          : `All ${handles.length} candidates were attempted; film activity loaded for ${fetched.length}${failed ? `; ${failed} accounts failed` : ""}.`,
      );
    } catch (error) {
      console.error(error);
      setStatus(language === "tr" ? "Letterboxd verisi cekilemedi" : "Could not fetch Letterboxd data");
    } finally {
      setLoading(false);
    }
  }

  function clearProfiles() {
    setUsers([]);
    setActiveId("");
    setStatus("");
    setTab("overview");
    localStorage.removeItem("tastetwin.users");
    localStorage.removeItem("tastetwin.active");
    void clearPersistentState(PERSISTENT_STATE_KEY);
  }

  async function copyShare() {
    if (!activeUser || !stats) return;
    const topMatch = matches[0];
    const text = `${activeUser.displayName} x ${topMatch?.user.displayName ?? "?"}: ${
      topMatch?.score ?? 0
    } TasteTwin score. ${stats.loved
      .slice(0, 3)
      .map((film) => film.title)
      .join(", ")}.`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <img src="/brand/tastetwin-icon.png" alt="" />
          </div>
          <div>
            <strong>{t(language, "appName")}</strong>
            <span>{accountHandle ? `@${accountHandle}` : activeUser ? `@${activeUser.handle}` : "live letterboxd"}</span>
          </div>
        </div>

        <div className="live-box">
          <label className="field-label" htmlFor="account-handle">
            {language === "tr" ? "Letterboxd kullanici adin" : "Your Letterboxd handle"}
          </label>
          <input
            id="account-handle"
            value={accountHandle}
            placeholder="kullaniciadi"
            onChange={(event) => setAccountHandle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") fetchSocialData("extension");
            }}
          />
          <button className="primary-button" onClick={() => fetchSocialData("extension")} disabled={socialLoading || loading}>
            {socialLoading ? <Loader2 className="spin" size={18} /> : <Link2 size={18} />}
            <span>{language === "tr" ? "Eklenti taramasini al" : "Load extension scan"}</span>
          </button>
          <button className="browser-scan-button" onClick={() => fetchSocialData("public")} disabled={socialLoading || loading}>
            <Globe2 size={17} />
            <span>{language === "tr" ? "Hizli acik kontrol (eksik olabilir)" : "Quick public check (may be partial)"}</span>
          </button>
          <a className="browser-scan-button" href="/tastetwin-extension.zip" download="tastetwin-extension.zip">
            <Download size={17} />
            <span>{language === "tr" ? "1. Eklenti ZIP'ini indir" : "1. Download extension ZIP"}</span>
          </a>
          <div className="extension-help">
            <strong>{language === "tr" ? "Eklenti kurulumu" : "Extension setup"}</strong>
            <ol>
              <li>{language === "tr" ? "Indirdigin ZIP'e sag tikla, Tumunu ayikla de." : "Right-click the downloaded ZIP and extract all files."}</li>
              <li>{language === "tr" ? "Chrome adres cubuguna chrome://extensions yaz; Gelistirici modu'nu ac." : "Open chrome://extensions and enable Developer mode."}</li>
              <li>{language === "tr" ? "Paketlenmemis oge yukle / Load unpacked ile ayiklanan klasoru sec." : "Choose Load unpacked and select the extracted folder."}</li>
            </ol>
            <code>chrome://extensions</code>
          </div>
        </div>

        <label className="upload-button" title={t(language, "import")}>
          <FileUp size={18} />
          <span>{language === "tr" ? "Tam film arsivi ZIP" : "Full film archive ZIP"}</span>
          <input type="file" accept=".zip,.csv,text/csv" onChange={(event) => handleUpload(event.target.files?.[0])} />
        </label>

        <div className="source-summary">
          <span>{language === "tr" ? "Benim arsiv" : "My archive"}</span>
          <strong>{uploadedUser ? uploadedUser.films.length : 0}</strong>
          <span>{language === "tr" ? "Film verisi alinan aday" : "Candidates with film data"}</span>
          <strong>{rssUsers.length}</strong>
          {currentSocial?.available && (
            <>
              <span>{language === "tr" ? "Sosyal agda takip" : "Social following"}</span>
              <strong>{currentSocial.counts.following}</strong>
            </>
          )}
        </div>

        <div className="sidebar-actions">
          <button title={t(language, "reset")} onClick={clearProfiles}>
            <RefreshCcw size={17} />
            <span>{t(language, "reset")}</span>
          </button>
        </div>

        {users.length > 0 && (
          <>
            <label className="field-label" htmlFor="profile-select">
              {t(language, "chooseProfile")}
            </label>
            <select id="profile-select" value={activeUser?.id ?? ""} onChange={(event) => setActiveId(event.target.value)}>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </>
        )}

        <div className="language-switch" aria-label={t(language, "language")}>
          <Languages size={17} />
          <button className={language === "tr" ? "active" : ""} onClick={() => setLanguage("tr")}>
            TR
          </button>
          <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>
            EN
          </button>
        </div>

        <nav className="tabs" aria-label="main">
          <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
            <BarChart3 size={18} />
            <span>{t(language, "navOverview")}</span>
          </button>
          <button className={tab === "matches" ? "active" : ""} onClick={() => setTab("matches")}>
            <Users size={18} />
            <span>{t(language, "navMatches")}</span>
          </button>
          <button className={tab === "social" ? "active" : ""} onClick={() => setTab("social")}>
            <UserCheck size={18} />
            <span>{language === "tr" ? "Sosyal" : "Social"}</span>
          </button>
          <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>
            <Globe2 size={18} />
            <span>{t(language, "navProfile")}</span>
          </button>
        </nav>

        {status && <p className="status-line">{status}</p>}
      </aside>

      <main className="main-grid">
        {!activeUser || !stats ? (
          <section className="empty-live">
            <div>
              <Link2 size={34} />
              <h1>{language === "tr" ? "Letterboxd hesabini bagla" : "Connect your Letterboxd account"}</h1>
              <p>
                {language === "tr"
                  ? "Once Benim export ile Letterboxd ZIP'ini yukle. Eklentiyi kurup kendi profilinde sosyal taramayi calistir. Sonra Sosyal sekmesinde tum takip ettiklerinle eslestir."
                  : "First upload your Letterboxd ZIP with My export. Install the extension and scan your own profile, then match everyone you follow from Social."}
              </p>
            </div>
          </section>
        ) : (
          <>
            <header className="top-strip">
              <div>
                <p>{activeUser.source === "rss" ? "Letterboxd RSS" : t(language, "profile")}</p>
                <h1>{activeUser.displayName}</h1>
              </div>
              <div className="score-chip">
                <Star size={18} />
                <strong>{matches[0]?.score ?? 0}</strong>
                <span>{t(language, "matchScore")}</span>
              </div>
            </header>

            {tab === "overview" && (
              <section className="view-grid overview-grid">
                <StatsPanel language={language} stats={stats} filmCount={activeUser.films.length} />
                <PosterPanel language={language} films={activeUser.films} />
                <BarsPanel title={t(language, "favoriteZones")} icon={<Film size={18} />} data={decadeData} />
                <BarsPanel title={t(language, "tasteDna")} icon={<Heart size={18} />} data={genreTerms} />
                <SignalPanel language={language} user={activeUser} directors={directorTerms} />
                <RecommendationPanel language={language} recommendations={recommendations} />
              </section>
            )}

            {tab === "matches" && (
              <section className="view-stack">
                <div className="filter-band">
                  <Filter size={18} />
                  <label>
                    {t(language, "minCommon")}
                    <input
                      type="range"
                      min="0"
                      max="8"
                      value={minCommon}
                      onChange={(event) => setMinCommon(Number(event.target.value))}
                    />
                    <strong>{minCommon}</strong>
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={requireDislike}
                      onChange={(event) => setRequireDislike(event.target.checked)}
                    />
                    {t(language, "withDislikes")}
                  </label>
                </div>

                <div className="match-list">
                  {filteredMatches.map((match) => (
                    <MatchCard key={match.user.id} language={language} match={match} />
                  ))}
                  {!filteredMatches.length && <p className="empty-state">{t(language, "emptyMatches")}</p>}
                </div>
              </section>
            )}

            {tab === "social" && (
              <SocialPanel
                language={language}
                data={socialByHandle[accountHandle || activeUser.handle]}
                loading={socialLoading || loading}
                onFetch={() => fetchSocialData("extension")}
                onUseFollowing={useFollowingAsMatchCandidates}
                onUseNetwork={useNetworkAsMatchCandidates}
              />
            )}

            {tab === "profile" && (
              <section className="profile-layout">
                <div className="share-card">
                  <div className="poster-strip" aria-hidden="true">
                    {activeUser.films.slice(0, 8).map((film, index) => (
                      <PosterTile key={film.key} film={film} index={index} />
                    ))}
                  </div>
                  <p>{t(language, "shareCard")}</p>
                  <h2>{activeUser.displayName}</h2>
                  <div className="share-score">
                    <strong>{matches[0]?.score ?? 0}</strong>
                    <span>{matches[0]?.user.displayName ?? "TasteTwin"}</span>
                  </div>
                  <div className="tag-cloud">
                    {[...decadeData.slice(0, 3), ...genreTerms.slice(0, 2)].map(([term]) => (
                      <span key={term}>{term}</span>
                    ))}
                  </div>
                </div>

                <div className="profile-side">
                  <h3>{t(language, "strongestSignals")}</h3>
                  <FilmList films={[...stats.loved, ...stats.disliked].slice(0, 8)} />
                  <button className="copy-button" onClick={copyShare} title={t(language, "copyText")}>
                    <Copy size={18} />
                    <span>{copied ? t(language, "copied") : t(language, "copyText")}</span>
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function StatsPanel({
  language,
  stats,
  filmCount,
}: {
  language: Language;
  stats: ReturnType<typeof getStats>;
  filmCount: number;
}) {
  const items = [
    [t(language, "films"), filmCount, Film],
    [t(language, "rated"), stats.rated, Star],
    [t(language, "reviews"), stats.reviews, Clapperboard],
    [t(language, "rewatches"), stats.rewatches, RefreshCcw],
    [t(language, "watchlist"), stats.watchlist, Heart],
  ] as const;

  return (
    <div className="stats-grid">
      {items.map(([label, value, Icon]) => (
        <div className="stat-tile" key={label}>
          <Icon size={18} />
          <strong>{value}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function SocialPanel({
  language,
  data,
  loading,
  onFetch,
  onUseFollowing,
  onUseNetwork,
}: {
  language: Language;
  data?: SocialData;
  loading: boolean;
  onFetch: () => void;
  onUseFollowing: () => void;
  onUseNetwork: () => void;
}) {
  if (!data) {
    return (
      <section className="social-layout">
        <div className="panel social-gate">
          <div className="panel-title">
            <UserCheck size={18} />
            <h2>{language === "tr" ? "Letterboxd sosyal agi" : "Letterboxd social graph"}</h2>
          </div>
          <button className="primary-button" onClick={onFetch} disabled={loading}>
            {loading ? <Loader2 className="spin" size={18} /> : <Users size={18} />}
            <span>{language === "tr" ? "Takip verisini yenile" : "Refresh social data"}</span>
          </button>
        </div>
      </section>
    );
  }

  if (!data.available) {
    return (
      <section className="social-layout">
        <div className="panel social-gate">
          <div className="panel-title">
            <UserMinus size={18} />
            <h2>{language === "tr" ? "Sosyal veri alinamadi" : "Social data unavailable"}</h2>
          </div>
          <p className="muted-line">{data.message}</p>
          <button className="primary-button" onClick={onFetch} disabled={loading}>
            <RefreshCcw size={18} />
            <span>{language === "tr" ? "Tekrar dene" : "Try again"}</span>
          </button>
        </div>
      </section>
    );
  }

  const groups = [
    [language === "tr" ? "Takip ettikleri" : "Following", data.counts.following, data.following],
    [language === "tr" ? "Takipciler" : "Followers", data.counts.followers, data.followers],
    [language === "tr" ? "Karsilikli" : "Mutuals", data.counts.mutuals, data.mutuals],
    [language === "tr" ? "Seni takip etmeyenler" : "Not following back", data.counts.notFollowingBack, data.notFollowingBack],
    [language === "tr" ? "Senin takip etmediklerin" : "Fans", data.counts.fans, data.fans],
    [language === "tr" ? "Takipten cikanlar" : "Lost followers", data.lostFollowers.length, data.lostFollowers],
    [language === "tr" ? "Yeni takipciler" : "New followers", data.newFollowers.length, data.newFollowers],
  ] as const;

  return (
    <section className="social-layout">
      <div className="panel social-actions">
        <div>
          <h2>{language === "tr" ? "Takip ettiklerine gore eslestir" : "Match against following"}</h2>
          <p className="muted-line">
            {language === "tr"
              ? `${data.source === "official-api" ? "Resmi API" : data.source === "browser-extension" ? "TasteTwin Chrome eklentisi" : data.source === "browser-session" ? "Tam tarayici oturumu" : "Halka acik profil sayfalari"} kullanildi. Takip ettiklerinin son film aktiviteleri zevk eslesmesine alinir.`
              : `${data.source === "official-api" ? "Official API" : data.source === "browser-extension" ? "TasteTwin Chrome extension" : data.source === "browser-session" ? "Full browser session" : "Public profile pages"} used. Recent film activity from your following is used for taste matching.`}
          </p>
          <p className="muted-line">
            {language === "tr" ? "Son basarili tarama" : "Last successful scan"}: {new Date(data.checkedAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}
          </p>
        </div>
        <button className="primary-button" onClick={onUseFollowing} disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
          <span>{language === "tr" ? "Eslestir" : "Match"}</span>
        </button>
      </div>
      {data.network && (
        <div className="panel social-actions">
          <div>
            <h2>{language === "tr" ? "Iki halkali ag" : "Two-hop network"}</h2>
            <p className="muted-line">
              {language === "tr"
              ? `${data.network.nodes} hesap, ${data.network.edges} bag bulundu${data.network.capped ? "; 10.000 tarama sinirina ulasti" : ""}. Tum ag adaylari sirayla denenir; buyuk aglar uzun surebilir.`
              : `${data.network.nodes} accounts and ${data.network.edges} edges found${data.network.capped ? "; reached the 10,000 scan limit" : ""}. Every network candidate is attempted in order; large networks can take a while.`}
            </p>
          </div>
          <button className="primary-button" onClick={onUseNetwork} disabled={loading}>
            {loading ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
            <span>{language === "tr" ? "Agdan eslestir" : "Match network"}</span>
          </button>
        </div>
      )}
      <div className="stats-grid social-stats">
        {groups.map(([label, value]) => (
          <div className="stat-tile" key={label}>
            <Users size={18} />
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {data.warning && (
        <p className="social-note">
          {language === "tr"
            ? data.complete
              ? "Liste tamamlandi. Letterboxd sifren alinmadi ve paylasilmadi."
              : "Letterboxd sayfalama siniri koydu; bu liste kismi. Eksiksiz sonuc icin soldaki tam tarama kodunu kendi Letterboxd profilinde calistir."
            : data.warning}
        </p>
      )}
      {!data.previousCheckedAt && data.complete !== false && (
        <p className="social-note">
          {language === "tr"
            ? "Takipten cikanlar ikinci taramadan itibaren gorunur; ilk tarama karsilastirma noktasi olarak kaydedildi."
            : "Lost followers appear from the second scan onward; this first scan is saved as the baseline."}
        </p>
      )}
      {groups.map(([label, , members]) => (
        <SocialMemberSection key={label} label={label} members={members} language={language} />
      ))}
    </section>
  );
}

function SocialMemberSection({
  label,
  members,
  language,
}: {
  label: string;
  members: SocialMember[];
  language: Language;
}) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(100);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? members.filter(
        (member) =>
          member.username.toLowerCase().includes(normalizedQuery) ||
          member.displayName.toLowerCase().includes(normalizedQuery),
      )
    : members;
  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="panel social-list">
      <div className="panel-title social-list-title">
        <UserCheck size={18} />
        <h2>{label}</h2>
        <strong>{members.length}</strong>
      </div>
      {members.length > 12 && (
        <label className="member-search">
          <Search size={16} />
          <input
            value={query}
            placeholder={language === "tr" ? "Kullanici ara" : "Search people"}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(100);
            }}
          />
        </label>
      )}
      <MemberList members={visible} />
      {visible.length < filtered.length && (
        <button className="load-more-button" onClick={() => setVisibleCount((count) => count + 100)}>
          <Users size={16} />
          <span>
            {language === "tr"
              ? `${visible.length} / ${filtered.length} gosteriliyor - daha fazla`
              : `${visible.length} / ${filtered.length} shown - load more`}
          </span>
        </button>
      )}
    </div>
  );
}

function MemberList({ members }: { members: SocialMember[] }) {
  if (!members.length) return <p className="muted-line">0</p>;
  return (
    <ul className="member-list">
      {members.map((member) => (
        <li key={member.username}>
          {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : <span>{member.displayName.slice(0, 1)}</span>}
          <a href={`https://letterboxd.com/${member.username}/`} target="_blank" rel="noreferrer">
            <strong>{member.displayName}</strong>
            <small>@{member.username}</small>
          </a>
        </li>
      ))}
    </ul>
  );
}

function PosterPanel({ language, films }: { language: Language; films: FilmSignal[] }) {
  return (
    <div className="panel poster-panel">
      <div className="panel-title">
        <Clapperboard size={18} />
        <h2>{language === "tr" ? "Canli akis" : "Live feed"}</h2>
      </div>
      <div className="poster-grid">
        {films.slice(0, 8).map((film, index) => (
          <PosterTile key={film.key} film={film} index={index} />
        ))}
      </div>
    </div>
  );
}

function BarsPanel({ title, icon, data }: { title: string; icon: React.ReactNode; data: Array<[string, number]> }) {
  const max = Math.max(...data.map(([, value]) => value), 1);
  return (
    <div className="panel">
      <div className="panel-title">
        {icon}
        <h2>{title}</h2>
      </div>
      <div className="bars">
        {data.length ? (
          data.map(([label, value]) => (
            <div className="bar-row" key={label}>
              <span>{label}</span>
              <div>
                <i style={{ width: `${Math.max(8, (value / max) * 100)}%` }} />
              </div>
            </div>
          ))
        ) : (
          <p className="muted-line">RSS</p>
        )}
      </div>
    </div>
  );
}

function SignalPanel({
  language,
  user,
  directors,
}: {
  language: Language;
  user: UserTaste;
  directors: Array<[string, number]>;
}) {
  const stats = getStats(user);
  return (
    <div className="panel signal-panel">
      <div className="panel-title">
        <Star size={18} />
        <h2>{t(language, "strongestSignals")}</h2>
      </div>
      <div className="signal-columns">
        <div>
          <h3>
            <Heart size={16} /> {t(language, "sharedLoves")}
          </h3>
          <FilmList films={stats.loved.slice(0, 4)} />
        </div>
        <div>
          <h3>
            <ThumbsDown size={16} /> {t(language, "sharedDislikes")}
          </h3>
          <FilmList films={stats.disliked.slice(0, 4)} />
        </div>
      </div>
      <div className="director-line">
        {directors.map(([director]) => (
          <span key={director}>{director}</span>
        ))}
      </div>
    </div>
  );
}

function RecommendationPanel({
  language,
  recommendations,
}: {
  language: Language;
  recommendations: ReturnType<typeof buildRecommendations>;
}) {
  return (
    <div className="panel recommendations-panel">
      <div className="panel-title">
        <Star size={18} />
        <h2>{t(language, "recommendations")}</h2>
      </div>
      <div className="recommendation-grid">
        {recommendations.map((item, index) => (
          <article key={item.film.key} className="recommendation">
            <PosterTile film={item.film} index={index} compact />
            <div>
              <strong>{item.film.title}</strong>
              <span>
                {item.from} · {item.score} {t(language, "score")}
              </span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function MatchCard({ language, match }: { language: Language; match: MatchResult }) {
  const reasons = reasonLines(match, language);
  const confidenceLabel =
    match.confidence >= 70
      ? language === "tr"
        ? "yuksek veri guveni"
        : "high data confidence"
      : match.confidence >= 35
        ? language === "tr"
          ? "orta veri guveni"
          : "medium data confidence"
        : language === "tr"
          ? "dusuk veri guveni"
          : "low data confidence";
  return (
    <article className="match-card">
      <div className="match-head">
        <div>
          <h2>{match.user.displayName}</h2>
          <span>@{match.user.handle}</span>
        </div>
        <div className="radial-score" style={{ "--score": `${match.score}%` } as React.CSSProperties}>
          <strong>{match.score}</strong>
        </div>
      </div>

      <div className="match-metrics">
        <Metric label={language === "tr" ? "ortak film kaydi" : "shared film records"} value={match.commonCount} />
        <Metric label={t(language, "sharedLoves")} value={match.sharedLoves.length} />
        <Metric label={t(language, "sharedDislikes")} value={match.sharedDislikes.length} />
        <Metric label={t(language, "divergences")} value={match.divergences.length} />
      </div>

      <p className="coverage-line">
        {language === "tr"
          ? `Adayin RSS akisinda gorulebilen ${match.candidateFilmCount} filmden ${match.commonCount} tanesi arsivinla eslesti. ${confidenceLabel} (${match.confidence}%).`
          : `${match.commonCount} of ${match.candidateFilmCount} films visible in this candidate's RSS activity matched your archive. ${confidenceLabel} (${match.confidence}%).`}
      </p>

      <div className="reason-list">
        <strong>{t(language, "why")}</strong>
        {reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
      </div>

      {match.togetherPick && (
        <div className="together-pick">
          <span>{t(language, "together")}</span>
          <strong>{match.togetherPick.title}</strong>
        </div>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function FilmList({ films }: { films: Array<{ key: string; title: string; year?: number; rating?: number }> }) {
  return (
    <ul className="film-list">
      {films.map((film) => (
        <li key={film.key}>
          <span>{film.title}</span>
          <small>
            {film.year}
            {film.rating !== undefined ? ` · ${film.rating.toFixed(film.rating % 1 ? 1 : 0)}` : ""}
          </small>
        </li>
      ))}
    </ul>
  );
}

function PosterTile({ film, index, compact = false }: { film: FilmSignal; index: number; compact?: boolean }) {
  const style = { "--poster-index": index } as React.CSSProperties;
  if (film.posterUrl) {
    return <img className={compact ? "mini-poster poster-image" : "poster-image"} src={film.posterUrl} alt={film.title} />;
  }
  return (
    <span className={compact ? "mini-poster poster-fallback" : "poster-fallback"} style={style}>
      {film.title.slice(0, 1)}
    </span>
  );
}

function reasonLines(match: MatchResult, language: Language) {
  const tr = language === "tr";
  const lines: string[] = [];
  if (match.sharedLoves[0]) {
    lines.push(
      tr
        ? `${match.sharedLoves[0].title} ikinizde de guclu pozitif sinyal.`
        : `${match.sharedLoves[0].title} is a strong positive signal for both.`,
    );
  }
  if (match.sharedDislikes[0]) {
    lines.push(
      tr
        ? `Ortak sevilmeyen film skoru keskinlestiriyor: ${match.sharedDislikes[0].title}.`
        : `Shared dislike sharpens the score: ${match.sharedDislikes[0].title}.`,
    );
  }
  if (match.divergences[0]) {
    lines.push(
      tr
        ? `Tartismali ayrisma: ${match.divergences[0].film.title}.`
        : `Useful split: ${match.divergences[0].film.title}.`,
    );
  }
  if (match.togetherPick) {
    lines.push(
      tr
        ? `${match.user.displayName} tarafindan yuksek puanlanmis yeni aday: ${match.togetherPick.title}.`
        : `${match.user.displayName} rated this unseen candidate highly: ${match.togetherPick.title}.`,
    );
  }
  return lines.length ? lines : match.reasons;
}

type AvailableSocialData = Extract<SocialData, { available: true }>;

function buildBrowserScannerBookmarklet() {
  return `javascript:(async()=>{try{if(!location.hostname.endsWith('letterboxd.com'))throw Error('Open your Letterboxd profile first');const h=location.pathname.split('/').filter(Boolean)[0];if(!h)throw Error('Profile not found');const w=open('http://127.0.0.1:5173/?bridge=1','tastetwin');const scan=async k=>{let u='/' + h + '/' + k + '/',a=[];while(u){const r=await fetch(u,{credentials:'include'});if(!r.ok)throw Error(k+' page failed: '+r.status);const d=new DOMParser().parseFromString(await r.text(),'text/html');a.push(...[...d.querySelectorAll('.person-summary')].map(x=>{const n=x.querySelector('a.name'),i=x.querySelector('img');const p=n?.getAttribute('href')?.split('/').filter(Boolean)[0];return p?{username:p,displayName:n.textContent.trim()||p,avatarUrl:i?.src}:null}).filter(Boolean));u=d.querySelector('.pagination a.next,.paginate-nextprev a.next')?.getAttribute('href')||''}return a};const [following,followers]=await Promise.all([scan('following'),scan('followers')]);await new Promise(r=>setTimeout(r,1600));w.postMessage({type:'TASTETWIN_SOCIAL',handle:h,following,followers},'http://127.0.0.1:5173');w.focus()}catch(e){alert('TasteTwin: '+e.message)}})()`;
}

function socialFromBrowserMessage(value: unknown): AvailableSocialData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as { handle?: unknown; following?: unknown; followers?: unknown };
  if (typeof data.handle !== "string" || !/^[a-z0-9_-]{2,32}$/i.test(data.handle)) return undefined;
  const following = cleanSocialMembers(data.following);
  const followers = cleanSocialMembers(data.followers);
  if (!following || !followers) return undefined;

  const followingNames = new Set(following.map((member) => member.username.toLowerCase()));
  const followerNames = new Set(followers.map((member) => member.username.toLowerCase()));
  const mutuals = following.filter((member) => followerNames.has(member.username.toLowerCase()));
  const notFollowingBack = following.filter((member) => !followerNames.has(member.username.toLowerCase()));
  const fans = followers.filter((member) => !followingNames.has(member.username.toLowerCase()));
  return {
    available: true,
    handle: data.handle.toLowerCase(),
    checkedAt: new Date().toISOString(),
    source: "browser-session",
    complete: true,
    warning: "Complete graph scanned inside your signed-in Letterboxd browser session; no password was shared.",
    counts: {
      following: following.length,
      followers: followers.length,
      mutuals: mutuals.length,
      notFollowingBack: notFollowingBack.length,
      fans: fans.length,
    },
    following,
    followers,
    mutuals,
    notFollowingBack,
    fans,
    lostFollowers: [],
    newFollowers: [],
  };
}

function cleanSocialMembers(value: unknown): SocialMember[] | undefined {
  if (!Array.isArray(value) || value.length > 10000) return undefined;
  const members = new Map<string, SocialMember>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const member = item as Record<string, unknown>;
    if (typeof member.username !== "string" || !/^[a-z0-9_-]{2,32}$/i.test(member.username)) continue;
    const username = member.username.toLowerCase();
    members.set(username, {
      username,
      displayName: typeof member.displayName === "string" ? member.displayName.slice(0, 100) : username,
      avatarUrl: typeof member.avatarUrl === "string" && /^https:\/\//.test(member.avatarUrl) ? member.avatarUrl : undefined,
    });
  }
  return [...members.values()];
}

function addFollowerChanges(handle: string, payload: AvailableSocialData): AvailableSocialData {
  const key = `tastetwin.followers.${handle}`;
  let previous: { checkedAt: string; followers: SocialMember[] } | undefined;
  try {
    previous = JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined;
  } catch {
    previous = undefined;
  }

  if (payload.complete === false) {
    return {
      ...payload,
      previousCheckedAt: previous?.checkedAt,
      lostFollowers: [],
      newFollowers: [],
    };
  }

  const currentNames = new Set(payload.followers.map((member) => member.username.toLowerCase()));
  const previousNames = new Set((previous?.followers ?? []).map((member) => member.username.toLowerCase()));
  const lostFollowers = previous?.followers.filter((member) => !currentNames.has(member.username.toLowerCase())) ?? [];
  const newFollowers = previous
    ? payload.followers.filter((member) => !previousNames.has(member.username.toLowerCase()))
    : [];

  localStorage.setItem(key, JSON.stringify({ checkedAt: payload.checkedAt, followers: payload.followers }));
  return {
    ...payload,
    previousCheckedAt: previous?.checkedAt,
    lostFollowers,
    newFollowers,
  };
}

function loadStoredUsers(): UserTaste[] {
  try {
    const value = JSON.parse(localStorage.getItem("tastetwin.users") ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function loadStoredSocial(): Record<string, SocialData> {
  try {
    const value = JSON.parse(localStorage.getItem("tastetwin.social") ?? "{}");
    for (const data of Object.values(value) as SocialData[]) {
      if (!data.available) continue;
      data.lostFollowers ??= [];
      data.newFollowers ??= [];
    }
    return value;
  } catch {
    return {};
  }
}
