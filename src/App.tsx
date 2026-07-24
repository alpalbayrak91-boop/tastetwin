import {
  BarChart3,
  ArrowLeft,
  ArrowRight,
  Clapperboard,
  Copy,
  Clock3,
  Dices,
  Download,
  ExternalLink,
  FileUp,
  Film,
  Filter,
  FolderOpen,
  Globe2,
  Heart,
  Info,
  KeyRound,
  Languages,
  Link2,
  Loader2,
  RefreshCcw,
  Search,
  Star,
  Sparkles,
  ThumbsDown,
  UserCheck,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "./i18n";
import { readLetterboxdExport } from "./lib/letterboxd";
import {
  filterAndSortMatches,
  paginateMatches,
  type MatchSort,
  type RelationshipFilter,
} from "./lib/discovery";
import {
  buildSocialDirectory,
  filterAndSortSocialDirectory,
  paginateSocialDirectory,
  type SocialDirectoryFilters,
  type SocialDirectoryEntry,
  type SocialDirectorySort,
  type SocialMemberRecord,
} from "./lib/social-directory";
import { clearPersistentState, loadPersistentState, savePersistentState } from "./lib/storage";
import {
  buildFilmInsights,
  buildWatchlistRanking,
  formatRuntime,
  pickNextWatch,
  type NextWatchMode,
} from "./lib/film-insights";
import {
  buildSocialActionCandidates,
  type SocialAction,
  type SocialActionRule,
} from "./lib/social-actions";
import { buildMatchesAsync, buildRecommendations, decadeTerms, getStats, topTerms } from "./lib/taste";
import type { FilmSignal, Language, MatchResult, UserTaste } from "./types";

type Tab = "overview" | "matches" | "social" | "profile";

type SocialMember = SocialMemberRecord;

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
      scanStage?: "social-complete" | "network-complete";
      complete?: boolean;
      warning?: string;
      previousCheckedAt?: string;
      history?: Array<{
        checkedAt: string;
        following: number;
        followers: number;
        mutuals: number;
        newFollowers: number;
        lostFollowers: number;
        networkCandidates?: number;
      }>;
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
      network?: {
        nodes: number;
        edges: number;
        capped: boolean;
        connectorsScanned?: number;
        failedConnectors?: number;
        candidateCount?: number;
        completedAt?: string;
      };
      networkCandidates?: SocialMember[];
    };

type PersistentAppState = {
  users: UserTaste[];
  activeId: string;
  accountHandle: string;
  socialByHandle: Record<string, SocialData>;
};

const PERSISTENT_STATE_KEY = "app";

type TmdbRunState = {
  phase: "idle" | "validating" | "enriching" | "done" | "error";
  message: string;
  processed: number;
  total: number;
  enriched: number;
  lastRun?: string;
};

type ActivityScanProgress = {
  processed: number;
  total: number;
  loaded: number;
  failed: number;
};

export default function App() {
  const [language, setLanguage] = useState<Language>("tr");
  const [tab, setTab] = useState<Tab>("overview");
  const [users, setUsers] = useState<UserTaste[]>(loadStoredUsers);
  const [activeId, setActiveId] = useState(() => localStorage.getItem("tastetwin.active") ?? "");
  const [accountHandle, setAccountHandle] = useState(() => localStorage.getItem("tastetwin.handle") ?? "");
  const [minCommon, setMinCommon] = useState(0);
  const [minSharedLoves, setMinSharedLoves] = useState(0);
  const [maxDivergences, setMaxDivergences] = useState(9999);
  const [minConfidence, setMinConfidence] = useState(0);
  const [minConnections, setMinConnections] = useState(0);
  const [maxConnections, setMaxConnections] = useState(9999);
  const [minNiche, setMinNiche] = useState(0);
  const [maxNiche, setMaxNiche] = useState(100);
  const [minActivity, setMinActivity] = useState(0);
  const [maxActivity, setMaxActivity] = useState(100);
  const [minScore, setMinScore] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [matchPage, setMatchPage] = useState(1);
  const [matchSort, setMatchSort] = useState<MatchSort>("recommended");
  const [networkCandidateLimit, setNetworkCandidateLimit] = useState(0);
  const [myFollowFilter, setMyFollowFilter] = useState<RelationshipFilter>("any");
  const [followsMeFilter, setFollowsMeFilter] = useState<RelationshipFilter>("any");
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [matchProgress, setMatchProgress] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<MatchResult>();
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialByHandle, setSocialByHandle] = useState<Record<string, SocialData>>(loadStoredSocial);
  const [copied, setCopied] = useState(false);
  const [preparedExtensionPath, setPreparedExtensionPath] = useState("");
  const [tmdbToken, setTmdbToken] = useState(() => localStorage.getItem("tastetwin.tmdbToken") ?? "");
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [tmdbRun, setTmdbRun] = useState<TmdbRunState>(() => {
    try {
      return JSON.parse(localStorage.getItem("tastetwin.tmdbRun") ?? "null") ?? {
        phase: "idle",
        message: "TMDB tokeni henuz dogrulanmadi.",
        processed: 0,
        total: 0,
        enriched: 0,
      };
    } catch {
      return { phase: "idle", message: "TMDB tokeni henuz dogrulanmadi.", processed: 0, total: 0, enriched: 0 };
    }
  });
  const [activityScanProgress, setActivityScanProgress] = useState<ActivityScanProgress>();
  const [storageReady, setStorageReady] = useState(false);

  const uploadedUser = users.find((user) => user.source === "upload");
  const rssUsers = users.filter((user) => user.source === "rss");
  const activeUser = users.find((user) => user.id === activeId) ?? users[0];
  const currentSocial = socialByHandle[accountHandle || activeUser?.handle || ""];
  const stats = useMemo(() => (activeUser ? getStats(activeUser) : undefined), [activeUser]);
  const followingHandles = useMemo(
    () =>
      new Set(
        currentSocial?.available
          ? currentSocial.following.map((member) => member.username.toLowerCase())
          : [],
      ),
    [currentSocial],
  );
  const followerHandles = useMemo(
    () =>
      new Set(
        currentSocial?.available
          ? currentSocial.followers.map((member) => member.username.toLowerCase())
          : [],
      ),
    [currentSocial],
  );
  const avatarByHandle = useMemo(() => {
    const avatars = new Map<string, string>();
    if (!currentSocial?.available) return avatars;
    for (const member of [...currentSocial.following, ...currentSocial.followers]) {
      if (member.avatarUrl) avatars.set(member.username.toLowerCase(), member.avatarUrl);
    }
    return avatars;
  }, [currentSocial]);
  const socialAccountCount = useMemo(
    () =>
      currentSocial?.available
        ? buildSocialDirectory({
            following: currentSocial.following,
            followers: currentSocial.followers,
            newFollowers: currentSocial.newFollowers,
            lostFollowers: currentSocial.lostFollowers,
            networkCandidates: currentSocial.networkCandidates,
          }, users, matches).length
        : 0,
    [currentSocial, matches, users],
  );
  const matchCandidates = useMemo(
    () => (activeUser ? users.filter((user) => user.id !== activeUser.id) : []),
    [activeUser, users],
  );
  const filteredMatches = useMemo(
    () =>
      filterAndSortMatches(
        matches,
        {
          minScore,
          minCommon,
          minSharedLoves,
          maxDivergences,
          minConfidence,
          minConnections,
          maxConnections,
          minNiche,
          maxNiche,
          minActivity,
          maxActivity,
          myFollow: myFollowFilter,
          followsMe: followsMeFilter,
        },
        matchSort,
        followingHandles,
        followerHandles,
      ),
    [
      followerHandles,
      followsMeFilter,
      followingHandles,
      matchSort,
      matches,
      maxActivity,
      maxConnections,
      maxDivergences,
      maxNiche,
      minCommon,
      minActivity,
      minConfidence,
      minConnections,
      minNiche,
      minScore,
      minSharedLoves,
      myFollowFilter,
    ],
  );
  const matchPagination = useMemo(
    () => paginateMatches(filteredMatches, matchPage, pageSize),
    [filteredMatches, matchPage, pageSize],
  );
  const topRecommended = useMemo(
    () => [...matches].sort((a, b) => b.recommendationScore - a.recommendationScore)[0],
    [matches],
  );
  const recommendations = useMemo(() => (activeUser ? buildRecommendations(activeUser, matches) : []), [activeUser, matches]);
  const genreTerms = useMemo(() => (activeUser ? topTerms(activeUser, "genres") : []), [activeUser]);
  const directorTerms = useMemo(() => (activeUser ? topTerms(activeUser, "directors", 4) : []), [activeUser]);
  const decadeData = useMemo(() => (activeUser ? decadeTerms(activeUser) : []), [activeUser]);
  const filmInsights = useMemo(
    () => (activeUser ? buildFilmInsights(activeUser, language) : undefined),
    [activeUser, language],
  );
  const watchlistRanking = useMemo(
    () => (activeUser ? buildWatchlistRanking(activeUser, language) : []),
    [activeUser, language],
  );

  useEffect(() => {
    setMatchPage(1);
  }, [
    followsMeFilter,
    matchSort,
    maxConnections,
    maxActivity,
    maxDivergences,
    maxNiche,
    minCommon,
    minActivity,
    minConfidence,
    minConnections,
    minNiche,
    minScore,
    minSharedLoves,
    myFollowFilter,
    pageSize,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!activeUser || !matchCandidates.length) {
      setMatches([]);
      setMatchProgress("");
      return;
    }
    setMatchProgress(language === "tr" ? "Eslestirmeler hesaplaniyor..." : "Calculating matches...");
    void buildMatchesAsync(activeUser, [activeUser, ...matchCandidates], (completed, total) => {
      if (!cancelled) {
        setMatchProgress(
          language === "tr"
            ? `Eslestirmeler hesaplaniyor: ${completed}/${total}`
            : `Calculating matches: ${completed}/${total}`,
        );
      }
    }).then((results) => {
      if (cancelled) return;
      setMatches(results);
      setMatchProgress("");
    });
    return () => {
      cancelled = true;
    };
  }, [activeUser, language, matchCandidates]);

  useEffect(() => {
    let cancelled = false;
    loadPersistentState<PersistentAppState>(PERSISTENT_STATE_KEY)
      .then((saved) => {
        if (cancelled || !saved) return;
        if (Array.isArray(saved.users)) setUsers(saved.users.map(deriveUserActivity));
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
      const imported = deriveUserActivity(await readLetterboxdExport(file, accountHandle));
      const nextUsers = [imported, ...users.filter((user) => user.source !== "upload")];
      setUsers(nextUsers);
      setActiveId(imported.id);
      setTab("overview");
      setStatus(
        language === "tr"
          ? `${t(language, "uploadOk")}: ${getStats(imported).watched} izlenen, ${getStats(imported).watchlist} watchlist. Hesabini baglayinca sosyal veriyi eslestirebilirsin.`
          : `${t(language, "uploadOk")}: ${getStats(imported).watched} watched, ${getStats(imported).watchlist} watchlist. Connect your handle to match social data.`,
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

  async function openLetterboxdAndScan() {
    const handle = (accountHandle || activeUser?.handle || "").trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(handle)) {
      setStatus(language === "tr" ? "Once Letterboxd kullanici adini yaz." : "Enter your Letterboxd handle first.");
      return;
    }
    setAccountHandle(handle);
    setStatus(language === "tr" ? "Chrome aciliyor; eklenti otomatik taramayi baslatacak." : "Opening Chrome; the extension will start automatically.");
    try {
      const response = await fetch("/api/extension/request-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-TasteTwin-Request": "app" },
        body: JSON.stringify({ handle }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "scan_request_failed");
      window.open(`https://letterboxd.com/${encodeURIComponent(handle)}/`, "_blank", "noopener,noreferrer");
      void waitForRequestedScan(handle, payload.requestedAt);
    } catch (error) {
      console.error(error);
      setStatus(language === "tr" ? "Otomatik tarama emri verilemedi." : "Could not request automatic scanning.");
    }
  }

  async function waitForRequestedScan(handle: string, requestedAt: string) {
    const deadline = Date.now() + 15 * 60 * 1000;
    let socialReceived = false;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 3500));
      try {
        const response = await fetch(`/api/letterboxd/social?handle=${encodeURIComponent(handle)}&source=extension`);
        if (!response.ok) continue;
        const payload = (await response.json()) as SocialData;
        if (!payload.available || Date.parse(payload.checkedAt) < Date.parse(requestedAt)) continue;
        const enriched = addFollowerChanges(handle, payload);
        setSocialByHandle((current) => ({ ...current, [handle]: enriched }));
        setTab("social");
        if (!socialReceived) {
          socialReceived = true;
          setStatus(
            language === "tr"
              ? `Sosyal listeler geldi: ${enriched.counts.following} takip, ${enriched.counts.followers} takipci. Ag taramasi suruyor.`
              : `Social lists received: ${enriched.counts.following} following, ${enriched.counts.followers} followers. Network scan continues.`,
          );
        }
        if (enriched.network?.completedAt && Date.parse(enriched.network.completedAt) >= Date.parse(requestedAt)) {
          setStatus(
            language === "tr"
              ? `Tarama tamamlandi: ${enriched.counts.following} takip, ${enriched.counts.followers} takipci, ${enriched.network.candidateCount ?? 0} ag adayi.`
              : `Scan complete: ${enriched.counts.following} following, ${enriched.counts.followers} followers, ${enriched.network.candidateCount ?? 0} network candidates.`,
          );
          return;
        }
      } catch {
        // The extension may still be scanning.
      }
    }
    setStatus(
      language === "tr"
        ? "Sosyal tarama bekleme suresi doldu. Chrome eklentisindeki son durumu kontrol et."
        : "Timed out waiting for the scan. Check the extension status in Chrome.",
    );
  }

  async function useFollowingAsMatchCandidates() {
    const handle = accountHandle || activeUser?.handle || "";
    const social = socialByHandle[handle];
    if (!social?.available) return;
    const followingHandles = social.following.map((member) => member.username);
    await fetchProfilesForHandles(followingHandles, social.following);
  }

  async function loadSocialActivity(handles: string[], members: SocialMember[]) {
    await fetchProfilesForHandles(handles, members, "social");
  }

  async function useNetworkAsMatchCandidates() {
    const handle = accountHandle || activeUser?.handle || "";
    if (!handle) return;
    setLoading(true);
    setStatus("");
    try {
      const handles: string[] = [];
      const members: SocialMember[] = [];
      let offset = 0;
      let total = 0;
      do {
        const remaining = networkCandidateLimit > 0 ? networkCandidateLimit - handles.length : 120;
        const pageSize = networkCandidateLimit > 0 ? Math.min(120, Math.max(1, remaining)) : 120;
        const response = await fetch(`/api/letterboxd/network?handle=${encodeURIComponent(handle)}&offset=${offset}&limit=${pageSize}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "network_not_scanned");
        handles.push(...(payload.handles as string[]));
        members.push(...((payload.members ?? []) as SocialMember[]));
        total = payload.total as number;
        offset = payload.nextOffset ?? total;
        setStatus(language === "tr" ? `Ag listesi aliniyor: ${handles.length}/${total}` : `Loading network list: ${handles.length}/${total}`);
      } while (offset < total && (networkCandidateLimit === 0 || handles.length < networkCandidateLimit));
      const directMembers = socialByHandle[handle]?.available
        ? [...socialByHandle[handle].following, ...socialByHandle[handle].followers]
        : [];
      const directHandles = [...new Set(directMembers.map((member) => member.username.toLowerCase()))];
      const directSet = new Set(directHandles);
      const discoveries = handles.filter(
        (candidate) => candidate !== handle.toLowerCase() && !directSet.has(candidate.toLowerCase()),
      );
      await fetchProfilesForHandles(
        [...directHandles, ...discoveries],
        [...directMembers, ...members],
      );
    } catch (error) {
      console.error(error);
      setStatus(language === "tr" ? "Ag taramasi bulunamadi. Chrome eklentisinden ag haritasini calistir." : "Network scan not found. Run the network map in the Chrome extension.");
      setLoading(false);
    }
  }

  async function fetchProfilesForHandles(
    cleanHandles: string[],
    members: SocialMember[] = [],
    targetTab: Tab = "social",
  ) {
    setLoading(true);
    setStatus("");
    try {
      const handles = [...new Set(cleanHandles.map((handle) => handle.trim().replace(/^@/, "").toLowerCase()).filter(Boolean))];
      if (!handles.length) throw new Error("handles_required");
      const memberByHandle = new Map(members.map((member) => [member.username.toLowerCase(), member]));
      const fetched: UserTaste[] = [];
      let failed = 0;
      const batchSize = 60;
      setActivityScanProgress({ processed: 0, total: handles.length, loaded: 0, failed: 0 });
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
        const enrichedBatch = ((payload.users ?? []) as UserTaste[]).map((user) => {
            const member = memberByHandle.get(user.handle.toLowerCase());
            return {
              ...user,
              displayName: member?.displayName || user.displayName,
              avatarUrl: member?.avatarUrl || user.avatarUrl,
              networkConnections: member?.connections,
              networkConnectionWeight: member?.connectionWeight,
              connectionHandles: member?.via,
              connectionDetails: member?.viaDetails,
            };
          });
        fetched.push(...enrichedBatch);
        failed += payload.errors?.length ?? 0;
        setUsers((current) => mergeRssUsers(current, enrichedBatch));
        setActivityScanProgress({
          processed: Math.min(offset + batch.length, handles.length),
          total: handles.length,
          loaded: fetched.length,
          failed,
        });
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      const currentUpload = users.find((user) => user.source === "upload");
      setActiveId(currentUpload?.id ?? fetched[0]?.id ?? "");
      setTab(currentUpload ? targetTab : "overview");
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

  async function prepareExtensionFolder() {
    setStatus("");
    try {
      const response = await fetch("/api/system/prepare-extension", {
        method: "POST",
        headers: { "X-TasteTwin-Request": "app" },
      });
      const payload = await response.json();
      if (!response.ok || typeof payload.path !== "string") {
        throw new Error(payload.error ?? "extension_prepare_failed");
      }
      setPreparedExtensionPath(payload.path);
      await navigator.clipboard.writeText(payload.path).catch(() => undefined);
      setStatus(
        language === "tr"
          ? "Eklenti klasoru hazirlandi, Windows Gezgini acildi ve klasor yolu kopyalandi."
          : "Extension folder prepared, opened in Explorer, and its path copied.",
      );
    } catch (error) {
      console.error(error);
      setStatus(
        language === "tr"
          ? "Eklenti klasoru hazirlanamadi. Uygulamanin masaustu surumunu acip tekrar dene."
          : "Could not prepare the extension folder. Open the desktop app and retry.",
      );
    }
  }

  async function enrichWithTmdb() {
    if (!activeUser || !tmdbToken.trim()) return;
    setTmdbLoading(true);
    setStatus("");
    const started: TmdbRunState = {
      phase: "validating",
      message: language === "tr" ? "Read Access Token TMDB ile dogrulaniyor." : "Validating the Read Access Token with TMDB.",
      processed: 0,
      total: 0,
      enriched: 0,
    };
    setTmdbRun(started);
    try {
      const validation = await fetch("/api/tmdb/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tmdbToken.trim() }),
      });
      const validationBody = await validation.json().catch(() => ({}));
      if (!validation.ok) throw new Error(validationBody.error ?? "tmdb_token_invalid");
      localStorage.setItem("tastetwin.tmdbToken", tmdbToken.trim());

      const films = activeUser.films.filter(
        (film) => film.watchlist || film.rating !== undefined || film.watchedDates.length > 0 || film.liked,
      );
      if (!films.length) throw new Error("zenginlestirilecek_film_yok");
      const metadata = new Map<string, Partial<FilmSignal>>();
      const batchSize = 25;
      setTmdbRun({
        phase: "enriching",
        message: language === "tr" ? `Token dogrulandi. ${films.length} film TMDB'de araniyor.` : `Token validated. Looking up ${films.length} films on TMDB.`,
        processed: 0,
        total: films.length,
        enriched: 0,
      });
      for (let offset = 0; offset < films.length; offset += batchSize) {
        setStatus(
          language === "tr"
            ? `TMDB metadata aliniyor: ${Math.min(offset + batchSize, films.length)}/${films.length}`
            : `Loading TMDB metadata: ${Math.min(offset + batchSize, films.length)}/${films.length}`,
        );
        const response = await fetch("/api/tmdb/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: tmdbToken.trim(), films: films.slice(offset, offset + batchSize) }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "tmdb_enrich_failed");
        for (const item of payload.results ?? []) metadata.set(item.key, item);
        setTmdbRun({
          phase: "enriching",
          message: language === "tr" ? "Sure, oyuncu, yonetmen, dil, ozet ve benzer film verisi aliniyor." : "Loading runtime, cast, directors, language, overview and related films.",
          processed: Math.min(offset + batchSize, films.length),
          total: films.length,
          enriched: metadata.size,
        });
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }

      setUsers((current) =>
        current.map((user) =>
          user.id === activeUser.id
            ? {
                ...user,
                films: user.films.map((film) => {
                  const item = metadata.get(film.key);
                  return item ? { ...film, ...item } : film;
                }),
              }
            : user,
        ),
      );
      setStatus(
        language === "tr"
          ? `${metadata.size} filme TMDB sure, ekip, dil, ozet ve onerileri eklendi.`
          : `Added TMDB runtime, credits, language, overview and recommendations to ${metadata.size} films.`,
      );
      const completed: TmdbRunState = {
        phase: "done",
        message: language === "tr" ? "Token dogrulandi ve TMDB verisi uygulamaya kaydedildi." : "Token validated and TMDB data was saved to the app.",
        processed: films.length,
        total: films.length,
        enriched: metadata.size,
        lastRun: new Date().toISOString(),
      };
      setTmdbRun(completed);
      localStorage.setItem("tastetwin.tmdbRun", JSON.stringify(completed));
    } catch (error) {
      console.error(error);
      const failed: TmdbRunState = {
        phase: "error",
        message: error instanceof Error ? error.message : "unknown_error",
        processed: 0,
        total: 0,
        enriched: 0,
        lastRun: new Date().toISOString(),
      };
      setTmdbRun(failed);
      localStorage.setItem("tastetwin.tmdbRun", JSON.stringify(failed));
      setStatus(
        language === "tr"
          ? `TMDB islemi tamamlanamadi: ${error instanceof Error ? error.message : "bilinmeyen hata"}`
          : `TMDB enrichment failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      setTmdbLoading(false);
    }
  }

  function resetFollowerHistory() {
    const handle = (accountHandle || activeUser?.handle || "").toLowerCase();
    if (!handle) return;
    localStorage.removeItem(`tastetwin.followers.${handle}`);
    setSocialByHandle((current) => {
      const social = current[handle];
      if (!social?.available) return current;
      return {
        ...current,
        [handle]: {
          ...social,
          previousCheckedAt: undefined,
          lostFollowers: [],
          newFollowers: [],
        },
      };
    });
    setStatus(
      language === "tr"
        ? "Takipci karsilastirma gecmisi sifirlandi. Sonraki tam tarama yeni baslangic olacak."
        : "Follower comparison history reset. The next complete scan becomes the new baseline.",
    );
  }

  function clearProfiles() {
    const handle = (accountHandle || activeUser?.handle || "").toLowerCase();
    setUsers([]);
    setActiveId("");
    setAccountHandle("");
    setSocialByHandle({});
    setMatches([]);
    setStatus("");
    setTab("overview");
    localStorage.removeItem("tastetwin.users");
    localStorage.removeItem("tastetwin.active");
    localStorage.removeItem("tastetwin.handle");
    if (handle) localStorage.removeItem(`tastetwin.followers.${handle}`);
    void clearPersistentState(PERSISTENT_STATE_KEY);
  }

  async function copyShare() {
    if (!activeUser || !stats) return;
    const topMatch = topRecommended;
    const text = `${activeUser.displayName} x ${topMatch?.user.displayName ?? "?"}: ${
      topMatch?.recommendationScore ?? 0
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

        <nav className="tabs" aria-label={language === "tr" ? "Gorunum secenekleri" : "View options"}>
          <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
            <BarChart3 size={18} />
            <span>{t(language, "navOverview")}</span>
          </button>
          <button className={tab === "social" ? "active" : ""} onClick={() => setTab("social")}>
            <UserCheck size={18} />
            <span>{language === "tr" ? "Sosyal" : "Social"}</span>
          </button>
        </nav>

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
              if (event.key === "Enter") openLetterboxdAndScan();
            }}
          />
          <button className="primary-button" onClick={openLetterboxdAndScan} disabled={socialLoading || loading}>
            {socialLoading ? <Loader2 className="spin" size={18} /> : <Globe2 size={18} />}
            <span>{language === "tr" ? "Letterboxd'u ac ve otomatik tara" : "Open Letterboxd and scan"}</span>
          </button>
          <button className="browser-scan-button" onClick={() => fetchSocialData("extension")} disabled={socialLoading || loading}>
            {socialLoading ? <Loader2 className="spin" size={18} /> : <Link2 size={18} />}
            <span>{language === "tr" ? "Son eklenti taramasini yukle" : "Load latest extension scan"}</span>
          </button>
          <button className="browser-scan-button" onClick={() => fetchSocialData("public")} disabled={socialLoading || loading}>
            <Globe2 size={17} />
            <span>{language === "tr" ? "Hizli acik kontrol (eksik olabilir)" : "Quick public check (may be partial)"}</span>
          </button>
          <button className="browser-scan-button" onClick={prepareExtensionFolder}>
            <FolderOpen size={17} />
            <span>{language === "tr" ? "Eklenti klasorunu hazirla" : "Prepare extension folder"}</span>
          </button>
          <div className="extension-help">
            <strong>{language === "tr" ? "Eklenti kurulumu" : "Extension setup"}</strong>
            <ol>
              <li>{language === "tr" ? "Yukaridaki dugme klasoru hazirlar ve acilir." : "The button above prepares and opens the folder."}</li>
              <li>{language === "tr" ? "Chrome'da chrome://extensions ac; Gelistirici modu'nu ac." : "Open chrome://extensions and enable Developer mode."}</li>
              <li>{language === "tr" ? "Load unpacked ile ZIP'i degil, acilan chrome-extension klasorunu sec." : "Choose Load unpacked and select the opened chrome-extension folder, not the ZIP."}</li>
            </ol>
            {preparedExtensionPath && <code>{preparedExtensionPath}</code>}
            <code>chrome://extensions</code>
            <a href="/tastetwin-extension.zip" download="tastetwin-extension.zip">
              <Download size={14} />
              {language === "tr" ? "ZIP'i ayrica indir" : "Download ZIP separately"}
            </a>
          </div>
        </div>

        <details className="usage-guide">
          <summary>
            <Info size={16} />
            {language === "tr" ? "Nasil kullanilir?" : "How to use"}
          </summary>
          <ol>
            <li>{language === "tr" ? "Letterboxd export ZIP'ini Tam film arsivi ile yukle." : "Load your Letterboxd export ZIP as the full archive."}</li>
            <li>{language === "tr" ? "Letterboxd'u ac ve otomatik tara dugmesine bas; profil acilinca guncel eklenti taramasi kendisi baslar." : "Press Open Letterboxd and scan; the extension starts when your profile opens."}</li>
            <li>{language === "tr" ? "Sosyal ekraninda takip durumu, degisim gecmisi, aktiflik ve zevk puanlarini birlikte filtrele." : "Filter relationships, history, activity and taste scores together in Social."}</li>
          </ol>
        </details>

        <details className="tmdb-settings">
          <summary>
            <KeyRound size={16} />
            <span>TMDB film zekasi</span>
          </summary>
          <p>
            {language === "tr"
              ? "Ucretsiz TMDB API Read Access Token'ini gir. Ortak sevilenlerden watchlist onerisi icin anahtar kelime, yonetmen ve TMDB onerileri kullanilir."
              : "Enter a free TMDB API Read Access Token. Keywords, directors and TMDB recommendations improve watchlist picks."}
          </p>
          <input
            type="password"
            value={tmdbToken}
            placeholder="eyJhbGci..."
            onChange={(event) => setTmdbToken(event.target.value)}
          />
          <button className="primary-button" onClick={enrichWithTmdb} disabled={!activeUser || !tmdbToken.trim() || tmdbLoading}>
            {tmdbLoading ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
            <span>{language === "tr" ? "Tokeni dogrula ve filmleri zenginlestir" : "Validate token and enrich films"}</span>
          </button>
          <div className={`tmdb-run-status tmdb-${tmdbRun.phase}`} aria-live="polite">
            <strong>
              {tmdbRun.phase === "done"
                ? language === "tr" ? "TMDB calisiyor" : "TMDB is working"
                : tmdbRun.phase === "error"
                  ? language === "tr" ? "TMDB hatasi" : "TMDB error"
                  : tmdbRun.phase === "idle"
                    ? language === "tr" ? "Henuz dogrulanmadi" : "Not validated yet"
                    : language === "tr" ? "TMDB isleniyor" : "TMDB processing"}
            </strong>
            <span>{tmdbRun.message}</span>
            {tmdbRun.total > 0 && <progress max={tmdbRun.total} value={tmdbRun.processed} />}
            <small>
              {language === "tr"
                ? `${tmdbRun.enriched} film zenginlestirildi${tmdbRun.lastRun ? ` · son calisma ${new Date(tmdbRun.lastRun).toLocaleString("tr-TR")}` : ""}`
                : `${tmdbRun.enriched} films enriched${tmdbRun.lastRun ? ` · last run ${new Date(tmdbRun.lastRun).toLocaleString("en-US")}` : ""}`}
            </small>
          </div>
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
            {language === "tr" ? "TMDB token alma sayfasi" : "Get a TMDB token"}
          </a>
          <details className="tmdb-form-guide">
            <summary>{language === "tr" ? "TMDB formuna ne yazacagim?" : "What should I enter in the TMDB form?"}</summary>
            <p>
              {language === "tr"
                ? "Su anki gelir getirmeyen kendi testin icin Personal use = Yes sec. Uygulama adi TasteTwin, tur Desktop Application (yoksa Other), URL asagidaki GitHub adresi olabilir. Adres alanlarina gercek kendi bilgilerini yaz."
                : "For your current non-revenue personal test choose Personal use = Yes. Use TasteTwin as the app name, Desktop Application (or Other) as the type, and the GitHub URL below. Enter your own real address details."}
            </p>
            <a href="https://github.com/alpalbayrak91-boop/tastetwin" target="_blank" rel="noreferrer">
              https://github.com/alpalbayrak91-boop/tastetwin
            </a>
            <code>
              {language === "tr"
                ? "TasteTwin, kullanicinin kendi Letterboxd export ve sosyal tarama verilerini yerel olarak analiz eden, film zevki eslestirmesi ve kisisel watchlist onerileri sunan gelir getirmeyen bir masaustu uygulamasidir."
                : "TasteTwin is a non-revenue desktop application that locally analyzes the user's own Letterboxd export and social scan data for taste matching and personal watchlist recommendations."}
            </code>
            <small>
              {language === "tr"
                ? "Halka acik veya gelir getiren surumde herkesin kendi anahtarini girmesi tek basina ticari lisans sorununu otomatik cozmez; yayinlamadan once TMDB kosullari yeniden kontrol edilmelidir."
                : "For a public or revenue-generating release, having every user enter a key does not automatically resolve licensing; review TMDB terms before publishing."}
            </small>
          </details>
          <small>This product uses the TMDB API but is not endorsed or certified by TMDB.</small>
        </details>

        <label className="upload-button" title={t(language, "import")}>
          <FileUp size={18} />
          <span>{language === "tr" ? "Tam film arsivi ZIP" : "Full film archive ZIP"}</span>
          <input type="file" accept=".zip,.csv,text/csv" onChange={(event) => handleUpload(event.target.files?.[0])} />
        </label>

        <div className="source-summary">
          <span>{language === "tr" ? "Izlenen film" : "Watched films"}</span>
          <strong>{uploadedUser ? getStats(uploadedUser).watched : 0}</strong>
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
                <strong>{topRecommended?.recommendationScore ?? 0}</strong>
                <span>{language === "tr" ? "oneri" : "recommended"}</span>
              </div>
            </header>

            {tab === "overview" && (
              <section className="view-grid overview-grid">
                <StatsPanel language={language} stats={stats} />
                <FilmInsightsPanel language={language} insights={filmInsights!} />
                <NextWatchPanel language={language} ranking={watchlistRanking} />
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
                  <div className="filter-heading">
                    <Filter size={18} />
                    <strong>{language === "tr" ? "Kesif filtreleri" : "Discovery filters"}</strong>
                  </div>
                  <label>
                    {language === "tr" ? "Ben takip ediyorum" : "I follow"}
                    <select value={myFollowFilter} onChange={(event) => setMyFollowFilter(event.target.value as RelationshipFilter)}>
                      <option value="any">{language === "tr" ? "Fark etmez" : "Any"}</option>
                      <option value="yes">{language === "tr" ? "Evet" : "Yes"}</option>
                      <option value="no">{language === "tr" ? "Hayir" : "No"}</option>
                    </select>
                  </label>
                  <label>
                    {language === "tr" ? "Beni takip ediyor" : "Follows me"}
                    <select value={followsMeFilter} onChange={(event) => setFollowsMeFilter(event.target.value as RelationshipFilter)}>
                      <option value="any">{language === "tr" ? "Fark etmez" : "Any"}</option>
                      <option value="yes">{language === "tr" ? "Evet" : "Yes"}</option>
                      <option value="no">{language === "tr" ? "Hayir" : "No"}</option>
                    </select>
                  </label>
                  <NumberFilter label={language === "tr" ? "Min ortak puanli" : "Min co-rated"} value={minCommon} min={0} max={9999} onChange={setMinCommon} />
                  <NumberFilter label={language === "tr" ? "Min ortak sevilen" : "Min shared loves"} value={minSharedLoves} min={0} max={9999} onChange={setMinSharedLoves} />
                  <NumberFilter label={language === "tr" ? "Maks ayrisma" : "Max splits"} value={maxDivergences} min={0} max={9999} onChange={setMaxDivergences} />
                  <NumberFilter label={language === "tr" ? "Min gecerlilik" : "Min validity"} value={minConfidence} min={0} max={100} suffix="%" onChange={setMinConfidence} />
                  <NumberFilter label={language === "tr" ? "Min ortak baglanti" : "Min mutual links"} value={minConnections} min={0} max={9999} onChange={setMinConnections} />
                  <NumberFilter label={language === "tr" ? "Maks ortak baglanti" : "Max mutual links"} value={maxConnections} min={0} max={9999} onChange={setMaxConnections} />
                  <NumberFilter label={language === "tr" ? "Min nislik" : "Min niche"} value={minNiche} min={0} max={100} onChange={setMinNiche} />
                  <NumberFilter label={language === "tr" ? "Maks nislik" : "Max niche"} value={maxNiche} min={0} max={100} onChange={setMaxNiche} />
                  <NumberFilter label={language === "tr" ? "Min aktiflik" : "Min activity"} value={minActivity} min={0} max={100} onChange={setMinActivity} />
                  <NumberFilter label={language === "tr" ? "Maks aktiflik" : "Max activity"} value={maxActivity} min={0} max={100} onChange={setMaxActivity} />
                  <NumberFilter label={language === "tr" ? "En az zevk skoru" : "Minimum taste score"} value={minScore} min={0} max={99} onChange={setMinScore} />
                  <label>
                    {language === "tr" ? "Sirala" : "Sort"}
                    <select value={matchSort} onChange={(event) => setMatchSort(event.target.value as MatchSort)}>
                      <option value="recommended">{language === "tr" ? "Onerilen" : "Recommended"}</option>
                      <option value="taste">{language === "tr" ? "Zevk skoru" : "Taste score"}</option>
                      <option value="niche">{language === "tr" ? "Nislik" : "Niche"}</option>
                      <option value="connections">{language === "tr" ? "Baglanti kalitesi" : "Connection quality"}</option>
                      <option value="activity">{language === "tr" ? "Aktiflik" : "Activity"}</option>
                      <option value="evidence">{language === "tr" ? "Ortak film" : "Co-rated films"}</option>
                      <option value="validity">{language === "tr" ? "Gecerlilik" : "Validity"}</option>
                    </select>
                  </label>
                  <label>
                    {language === "tr" ? "Sayfa boyutu" : "Page size"}
                    <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                      {[25, 50, 100, 250].map((size) => (
                        <option value={size} key={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="reset-filter-button"
                    onClick={() => {
                      setMyFollowFilter("any");
                      setFollowsMeFilter("any");
                      setMinCommon(0);
                      setMinSharedLoves(0);
                      setMaxDivergences(9999);
                      setMinConfidence(0);
                      setMinConnections(0);
                      setMaxConnections(9999);
                      setMinNiche(0);
                      setMaxNiche(100);
                      setMinActivity(0);
                      setMaxActivity(100);
                      setMinScore(0);
                    }}
                  >
                    <RefreshCcw size={16} />
                    {language === "tr" ? "Filtreleri sifirla" : "Reset filters"}
                  </button>
                </div>

                <details className="score-guide">
                  <summary>
                    <Info size={16} />
                    {language === "tr" ? "Puan nasil hesaplaniyor?" : "How is the score calculated?"}
                  </summary>
                  <p>
                    {language === "tr"
                      ? "Yalnizca ikinizin de puan verdigi filmler kullanilir. 0-1 puan fark arti, 1.5 fark notr, 2 ve uzeri giderek eksi yazar. 2/4 gibi sevme-sevmeme ayrimi, 0.5/2.5 gibi iki dusuk puandan daha agir eksidir. Watchlist ve puansiz izlemeler ortak sayilmaz."
                      : "Only films rated by both people count. A 0-1 point gap is positive, 1.5 is neutral, and gaps of 2 or more become increasingly negative. A 2/4 like-dislike split is penalized more than two low ratings such as 0.5/2.5. Watchlist and unrated films are excluded."}
                  </p>
                  <p>
                    {language === "tr"
                      ? "Cok sayida ayrisma ek ceza getirir. Yerel agda az puanlanan veya gorusleri bolen filmler en fazla %50 daha agir sinyal olabilir. Gecerlilik ortak puanli film sayisina gore artar; az veri varsa ham puan 50'ye yaklastirilir."
                      : "Many splits add an extra penalty. Films that are rare or divisive in the loaded network can carry up to 50% more weight. Validity rises with co-rated evidence; sparse evidence pulls the raw score toward 50."}
                  </p>
                  <p>
                    {language === "tr"
                      ? "Onerilen puan: zevk %70, kanit gecerliligi %8, ortak baglanti kalitesi %11, nislik %6 ve son film aktifligi %5. Baglanti kalitesinde cok genis bir cevreyi takip eden baglayicilar daha dusuk agirlik alir."
                      : "Recommendation score: 70% taste, 8% evidence validity, 11% connection quality, 6% niche and 5% recent film activity. Connectors following a very broad set of accounts receive less weight."}
                  </p>
                </details>

                <p className="match-summary">
                  {matchProgress ||
                    (language === "tr"
                      ? `${matchCandidates.length} aday hesaplandi; ${filteredMatches.length} filtreye uyuyor. ${matchPagination.start + (filteredMatches.length ? 1 : 0)}-${matchPagination.end} arasi gosteriliyor.`
                      : `${matchCandidates.length} candidates calculated; ${filteredMatches.length} match the filters. Showing ${matchPagination.start + (filteredMatches.length ? 1 : 0)}-${matchPagination.end}.`)}
                </p>
                {socialAccountCount > matchCandidates.length && (
                  <p className="match-data-note">
                    {language === "tr"
                      ? `${socialAccountCount} sosyal hesap kayitli; eslesme puani yalniz film/RSS verisi alinmis ${matchCandidates.length} kisi icin hesaplanabilir. Diger hesaplar Sosyal ag ekraninda eksiksiz yonetilir.`
                      : `${socialAccountCount} social accounts are stored; taste matching can score only the ${matchCandidates.length} people with film/RSS data. Everyone remains manageable in Social graph.`}
                  </p>
                )}
                <div className="match-list">
                  {matchPagination.items.map((match) => (
                    <MatchCard
                      key={match.user.id}
                      language={language}
                      match={match}
                      avatarUrl={match.user.avatarUrl || avatarByHandle.get(match.user.handle.toLowerCase())}
                      onSelect={() => setSelectedMatch(match)}
                    />
                  ))}
                  {!filteredMatches.length && <p className="empty-state">{t(language, "emptyMatches")}</p>}
                </div>
                {filteredMatches.length > 0 && (
                  <nav className="match-pagination" aria-label={language === "tr" ? "Eslesme sayfalari" : "Match pages"}>
                    <button disabled={matchPagination.page <= 1} onClick={() => setMatchPage((page) => Math.max(1, page - 1))}>
                      {language === "tr" ? "Onceki" : "Previous"}
                    </button>
                    <span>
                      {language === "tr" ? "Sayfa" : "Page"} {matchPagination.page} / {matchPagination.totalPages}
                    </span>
                    <button
                      disabled={matchPagination.page >= matchPagination.totalPages}
                      onClick={() => setMatchPage((page) => Math.min(matchPagination.totalPages, page + 1))}
                    >
                      {language === "tr" ? "Sonraki" : "Next"}
                    </button>
                  </nav>
                )}
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
                users={users}
                matches={matches}
                onLoadActivity={loadSocialActivity}
                activityScanProgress={activityScanProgress}
                onSelectMatch={setSelectedMatch}
                networkCandidateLimit={networkCandidateLimit}
                onNetworkCandidateLimitChange={setNetworkCandidateLimit}
                onResetHistory={resetFollowerHistory}
              />
            )}

            {tab === "profile" && (
              <section className="profile-layout">
                <div className="panel share-explainer">
                  <h2>{language === "tr" ? "Paylasim karti ne ise yarar?" : "What is the share card for?"}</h2>
                  <p className="muted-line">
                    {language === "tr"
                      ? "Bu, Letterboxd veya sosyal medyada paylasabilecegin kisa zevk ozeti. Su an metni panoya kopyalar; film verini ya da sifreni internete yuklemez."
                      : "This is a compact taste summary for Letterboxd or social media. It currently copies text to your clipboard and does not upload your film data or password."}
                  </p>
                </div>
                <div className="share-card">
                  <div className="poster-strip" aria-hidden="true">
                    {activeUser.films.slice(0, 8).map((film, index) => (
                      <PosterTile key={film.key} film={film} index={index} />
                    ))}
                  </div>
                  <p>{t(language, "shareCard")}</p>
                  <h2>{activeUser.displayName}</h2>
                  <div className="share-score">
                    <strong>{topRecommended?.recommendationScore ?? 0}</strong>
                    <span>{topRecommended?.user.displayName ?? "TasteTwin"}</span>
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
      {selectedMatch && (
        <MatchDetail
          language={language}
          match={selectedMatch}
          avatarUrl={selectedMatch.user.avatarUrl || avatarByHandle.get(selectedMatch.user.handle.toLowerCase())}
          onClose={() => setSelectedMatch(undefined)}
        />
      )}
    </div>
  );
}

function StatsPanel({
  language,
  stats,
}: {
  language: Language;
  stats: ReturnType<typeof getStats>;
}) {
  const items = [
    [t(language, "films"), stats.watched, Film],
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

function FilmInsightsPanel({
  language,
  insights,
}: {
  language: Language;
  insights: ReturnType<typeof buildFilmInsights>;
}) {
  const metrics = [
    [language === "tr" ? "Toplam izleme" : "Total views", insights.totalViews],
    [language === "tr" ? "Izleme suresi" : "Watch time", formatRuntime(insights.totalRuntimeMinutes, language)],
    [language === "tr" ? "Ortalama puan" : "Average rating", insights.averageRating ? insights.averageRating.toFixed(2) : "-"],
    [language === "tr" ? "TMDB kapsami" : "TMDB coverage", `%${insights.metadataCoverage}`],
  ];
  const groups = [
    [language === "tr" ? "Turler" : "Genres", insights.topGenres],
    [language === "tr" ? "Yonetmenler" : "Directors", insights.topDirectors],
    [language === "tr" ? "Oyuncular" : "Cast", insights.topCast],
    [language === "tr" ? "Diller" : "Languages", insights.topLanguages],
  ] as const;

  return (
    <>
      <div className="panel film-insights" data-testid="film-insights">
        <div className="panel-title">
          <BarChart3 size={18} />
          <h2>{language === "tr" ? "Film gecmisi istatistikleri" : "Film history insights"}</h2>
        </div>
        <div className="insight-metrics">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <p className="metadata-note">
          {language === "tr"
            ? `Sure hesabi ${insights.runtimeCoverage}% kapsama dayanir. Tekrar izlemeler dahil edilir; watchlist izlenmis sayilmaz.`
            : `Watch time uses ${insights.runtimeCoverage}% runtime coverage. Rewatches count; watchlist-only films do not.`}
        </p>
      </div>
      <div className="panel taste-facts">
        <div className="panel-title">
          <Sparkles size={18} />
          <h2>{language === "tr" ? "En cok izlediklerin" : "Your most watched signals"}</h2>
        </div>
        <div className="ranked-groups">
          {groups.map(([title, items]) => (
            <section key={title}>
              <h3>{title}</h3>
              {items.length ? (
                <ol>
                  {items.slice(0, 5).map((item) => (
                    <li key={item.name}>
                      <span>{item.name}</span>
                      <strong>{item.count}</strong>
                    </li>
                  ))}
                </ol>
              ) : (
                <small>{language === "tr" ? "TMDB zenginlestirmesi gerekli" : "TMDB enrichment required"}</small>
              )}
            </section>
          ))}
        </div>
      </div>
      <div className="panel viewing-rhythm">
        <div className="panel-title">
          <Clock3 size={18} />
          <h2>{language === "tr" ? "Izleme yogunlugu" : "Viewing rhythm"}</h2>
        </div>
        <MiniBars
          data={insights.monthlyActivity}
          empty={language === "tr" ? "Diary tarih verisi yok" : "No diary dates"}
        />
        <div className="weekday-row">
          {insights.weekdayActivity.map((item) => (
            <div key={item.name}>
              <strong>{item.count}</strong>
              <span>{item.name}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function MiniBars({ data, empty }: { data: Array<{ name: string; count: number }>; empty: string }) {
  if (!data.length) return <p className="muted-line">{empty}</p>;
  const max = Math.max(...data.map((item) => item.count), 1);
  return (
    <div className="mini-bars">
      {data.map((item) => (
        <div key={item.name} title={`${item.name}: ${item.count}`}>
          <span style={{ height: `${Math.max(5, (item.count / max) * 100)}%` }} />
          <small>{item.name.slice(5)}</small>
        </div>
      ))}
    </div>
  );
}

function NextWatchPanel({
  language,
  ranking,
}: {
  language: Language;
  ranking: ReturnType<typeof buildWatchlistRanking>;
}) {
  const [mode, setMode] = useState<NextWatchMode>("taste");
  const [seed, setSeed] = useState(0);
  const pick = useMemo(() => pickNextWatch(ranking, mode, seed), [mode, ranking, seed]);

  return (
    <div className="panel next-watch" data-testid="next-watch">
      <div className="panel-title">
        <Dices size={18} />
        <h2>{language === "tr" ? "Siradaki film" : "Next watch"}</h2>
      </div>
      <div className="mode-switch" role="group" aria-label={language === "tr" ? "Secim modu" : "Pick mode"}>
        {([
          ["taste", language === "tr" ? "Zevkime gore" : "Taste fit"],
          ["short", language === "tr" ? "Kisa" : "Short"],
          ["random", language === "tr" ? "Rastgele" : "Random"],
        ] as Array<[NextWatchMode, string]>).map(([value, label]) => (
          <button className={mode === value ? "active" : ""} onClick={() => setMode(value)} key={value}>
            {label}
          </button>
        ))}
      </div>
      {pick ? (
        <div className="next-watch-body">
          <PosterTile film={pick.film} index={0} />
          <div>
            <h3>
              {pick.film.title} {pick.film.year ? `(${pick.film.year})` : ""}
            </h3>
            <p className="next-watch-meta">
              {pick.film.runtimeMinutes ? `${pick.film.runtimeMinutes} dk` : language === "tr" ? "Sure verisi yok" : "No runtime"}
              {pick.film.directors[0] ? ` · ${pick.film.directors[0]}` : ""}
            </p>
            <p>{pick.film.overview || pick.reason}</p>
            {pick.film.overview && <small>{pick.reason}</small>}
            <button className="secondary-button" onClick={() => setSeed((current) => current + 1)}>
              <RefreshCcw size={16} />
              {language === "tr" ? "Baska sec" : "Pick another"}
            </button>
          </div>
        </div>
      ) : (
        <p className="empty-state">
          {language === "tr"
            ? "Izlenmemis watchlist filmi yok. Once Letterboxd exportunu yenile."
            : "No unwatched watchlist films. Refresh your Letterboxd export first."}
        </p>
      )}
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
  users,
  matches,
  onLoadActivity,
  activityScanProgress,
  onSelectMatch,
  networkCandidateLimit,
  onNetworkCandidateLimitChange,
  onResetHistory,
}: {
  language: Language;
  data?: SocialData;
  loading: boolean;
  onFetch: () => void;
  onUseFollowing: () => void;
  onUseNetwork: () => void;
  users: UserTaste[];
  matches: MatchResult[];
  onLoadActivity: (handles: string[], members: SocialMember[]) => void;
  activityScanProgress?: ActivityScanProgress;
  onSelectMatch: (match: MatchResult) => void;
  networkCandidateLimit: number;
  onNetworkCandidateLimitChange: (value: number) => void;
  onResetHistory: () => void;
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

  const changeWindow = data.previousCheckedAt
    ? language === "tr"
      ? `${new Date(data.previousCheckedAt).toLocaleString("tr-TR")} ile ${new Date(data.checkedAt).toLocaleString("tr-TR")} arasinda degismis olabilir. Kesin an bilinmez.`
      : `May have changed between ${new Date(data.previousCheckedAt).toLocaleString("en-US")} and ${new Date(data.checkedAt).toLocaleString("en-US")}. The exact moment is unknown.`
    : undefined;
  return (
    <section className="social-layout">
      <div className="panel social-actions">
        <div>
          <h2>{language === "tr" ? "Takip ettiklerinin film verisi" : "Film data for people you follow"}</h2>
          <p className="muted-line">
            {language === "tr"
              ? `${data.source === "official-api" ? "Resmi API" : data.source === "browser-extension" ? "TasteTwin Chrome eklentisi" : data.source === "browser-session" ? "Tam tarayici oturumu" : "Halka acik profil sayfalari"} kullanildi. Film verisi alinan kisiler ayni sosyal listede zevk puaniyla siralanabilir.`
              : `${data.source === "official-api" ? "Official API" : data.source === "browser-extension" ? "TasteTwin Chrome extension" : data.source === "browser-session" ? "Full browser session" : "Public profile pages"} used. People with film data can be sorted by taste score in the same social list.`}
          </p>
          <p className="muted-line">
            {language === "tr" ? "Son basarili tarama" : "Last successful scan"}: {new Date(data.checkedAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}
          </p>
        </div>
        <button className="primary-button" onClick={onUseFollowing} disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
          <span>{language === "tr" ? "Film verilerini al" : "Load film data"}</span>
        </button>
      </div>
      {data.network && (
        <div className="panel social-actions">
          <div>
            <h2>{language === "tr" ? "Iki halkali ag" : "Two-hop network"}</h2>
            <p className="muted-line">
              {language === "tr"
              ? `${data.network.nodes} hesap, ${data.network.edges} bag ve ${data.network.candidateCount ?? "?"} yeni aday kaydedildi${data.network.capped ? "; 10.000 dugume ulasti" : ""}. ${data.network.connectorsScanned ?? "?"} baglayici tarandi. Kesif yalniz senin takip ettiklerinden gunluk rastgele ve dengeli bir ornekle baslar; her baglayicidan sinirli hesap alinir.`
              : `${data.network.nodes} accounts, ${data.network.edges} edges and ${data.network.candidateCount ?? "?"} new candidates saved${data.network.capped ? "; reached 10,000 nodes" : ""}. ${data.network.connectorsScanned ?? "?"} connectors scanned. Discovery starts from a daily balanced random sample of only the people you follow, with a per-connector limit.`}
            </p>
            {data.network.completedAt && (
              <strong>
                {language === "tr" ? "Ag taramasi kaydi" : "Network scan record"}:{" "}
                {new Date(data.network.completedAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}
              </strong>
            )}
          </div>
          <div className="network-match-controls">
            <label>
              {language === "tr" ? "Dene" : "Try"}
              <select
                value={networkCandidateLimit}
                onChange={(event) => onNetworkCandidateLimitChange(Number(event.target.value))}
              >
                {[100, 250, 500, 1000].map((limit) => (
                  <option value={limit} key={limit}>{limit}</option>
                ))}
                <option value={0}>{language === "tr" ? "Tumu" : "All"}</option>
              </select>
            </label>
            <button className="primary-button" onClick={onUseNetwork} disabled={loading}>
              {loading ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
              <span>{language === "tr" ? "Takip etmedigim kisileri bul" : "Find people I do not follow"}</span>
            </button>
          </div>
        </div>
      )}
      <div className="panel history-explainer">
        <div>
          <h2>{language === "tr" ? "Takip degisiklikleri nasil bulunuyor?" : "How follow changes are detected"}</h2>
          <p className="muted-line">
            {language === "tr"
              ? "Tam eklenti taramasindaki takipci listesi bu bilgisayarda TasteTwin uygulama verisine kaydedilir. Sonraki tam tarama onceki listeyle karsilastirilir; eksilenler Takipten cikanlar, eklenenler Yeni takipciler olur. Uygulama verisini silersen veya bilgisayar degistirirsen bu gecmis de silinir."
              : "The follower list from a complete extension scan is stored in TasteTwin's local app data on this computer. The next complete scan is compared with it to find lost and new followers. Clearing app data or changing computers removes this history."}
          </p>
          <strong>
            {data.previousCheckedAt
              ? `${language === "tr" ? "Karsilastirilan onceki tarama" : "Previous scan compared"}: ${new Date(data.previousCheckedAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}`
              : language === "tr"
                ? "Bu tarama baslangic noktasi olarak kaydedildi."
                : "This scan is saved as the baseline."}
          </strong>
          {changeWindow && <p className="history-window">{changeWindow}</p>}
          {data.history && data.history.length > 0 && (
            <div className="scan-history-list">
              {data.history.slice(-5).reverse().map((scan) => (
                <span key={scan.checkedAt}>
                  <time>{new Date(scan.checkedAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}</time>
                  <b>{scan.following} / {scan.followers}</b>
                  <small>+{scan.newFollowers} / -{scan.lostFollowers}</small>
                </span>
              ))}
            </div>
          )}
        </div>
        <button className="browser-scan-button" onClick={onResetHistory}>
          <RefreshCcw size={17} />
          <span>{language === "tr" ? "Takip gecmisini sifirla" : "Reset follow history"}</span>
        </button>
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
      <SocialDirectory
        language={language}
        data={data}
        users={users}
        matches={matches}
        loading={loading}
        onLoadActivity={onLoadActivity}
        activityScanProgress={activityScanProgress}
        onSelectMatch={onSelectMatch}
      />
    </section>
  );
}

function SocialDirectory({
  language,
  data,
  users,
  matches,
  loading,
  onLoadActivity,
  activityScanProgress,
  onSelectMatch,
}: {
  language: Language;
  data: AvailableSocialData;
  users: UserTaste[];
  matches: MatchResult[];
  loading: boolean;
  onLoadActivity: (handles: string[], members: SocialMember[]) => void;
  activityScanProgress?: ActivityScanProgress;
  onSelectMatch: (match: MatchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [myFollow, setMyFollow] = useState<RelationshipFilter>("any");
  const [followsMe, setFollowsMe] = useState<RelationshipFilter>("any");
  const [source, setSource] = useState<"all" | "direct" | "network">("all");
  const [activity, setActivity] = useState<"any" | "known" | "unknown">("any");
  const [category, setCategory] = useState<SocialDirectoryFilters["category"]>("all");
  const [minTaste, setMinTaste] = useState(0);
  const [maxTaste, setMaxTaste] = useState(100);
  const [minDirectoryActivity, setMinDirectoryActivity] = useState(0);
  const [maxDirectoryActivity, setMaxDirectoryActivity] = useState(100);
  const [minDirectoryConnections, setMinDirectoryConnections] = useState(0);
  const [maxDirectoryConnections, setMaxDirectoryConnections] = useState(9999);
  const [sort, setSort] = useState<SocialDirectorySort>("relationship");
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);
  const directory = useMemo(
    () => buildSocialDirectory({
      following: data.following,
      followers: data.followers,
      newFollowers: data.newFollowers,
      lostFollowers: data.lostFollowers,
      networkCandidates: data.networkCandidates,
    }, users, matches),
    [data, matches, users],
  );
  const filtered = useMemo(
    () => filterAndSortSocialDirectory(directory, {
      query,
      myFollow,
      followsMe,
      source,
      activity,
      category,
      minTaste,
      maxTaste,
      minActivity: minDirectoryActivity,
      maxActivity: maxDirectoryActivity,
      minConnections: minDirectoryConnections,
      maxConnections: maxDirectoryConnections,
      sort,
    }),
    [activity, category, directory, followsMe, maxDirectoryActivity, maxDirectoryConnections, maxTaste, minDirectoryActivity, minDirectoryConnections, minTaste, myFollow, query, sort, source],
  );
  const pagination = useMemo(
    () => paginateSocialDirectory(filtered, page, pageSize),
    [filtered, page, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [activity, category, followsMe, maxDirectoryActivity, maxDirectoryConnections, maxTaste, minDirectoryActivity, minDirectoryConnections, minTaste, myFollow, pageSize, query, sort, source]);

  const activityKnown = filtered.filter((entry) => entry.activity?.lastActivityAt).length;
  const missingActivity = directory.filter((entry) => !entry.activity?.lastActivityAt);
  const missingActivityMembers = missingActivity.map(directoryEntryToMember);
  const categories: Array<{
    id: SocialDirectoryFilters["category"];
    label: string;
    value: number;
  }> = [
    { id: "all", label: language === "tr" ? "Tum sosyal veriler" : "All people", value: directory.length },
    { id: "following", label: language === "tr" ? "Takip ettiklerin" : "Following", value: data.counts.following },
    { id: "followers", label: language === "tr" ? "Takipcilerin" : "Followers", value: data.counts.followers },
    { id: "mutuals", label: language === "tr" ? "Karsilikli" : "Mutuals", value: data.counts.mutuals },
    { id: "not-following-back", label: language === "tr" ? "Seni takip etmeyen" : "Not following back", value: data.counts.notFollowingBack },
    { id: "fans", label: language === "tr" ? "Senin takip etmedigin" : "You do not follow", value: data.counts.fans },
    { id: "new", label: language === "tr" ? "Yeni takipci" : "New followers", value: data.newFollowers.length },
    { id: "lost", label: language === "tr" ? "Takipten cikan" : "Lost followers", value: data.lostFollowers.length },
    { id: "network", label: language === "tr" ? "Agdan bulunan" : "Network discoveries", value: directory.filter((entry) => entry.inNetwork && !entry.myFollow && !entry.followsMe).length },
  ];

  return (
    <div className="panel social-directory">
      <div className="panel-title social-directory-title">
        <UserCheck size={18} />
        <div>
          <h2>{language === "tr" ? "Sosyal veriler" : "Social data"}</h2>
          <p>
            {language === "tr"
              ? `${directory.length} tekil hesap; film verisi olmayanlar da dahildir.`
              : `${directory.length} unique accounts, including people without film data.`}
          </p>
        </div>
        <strong>{filtered.length}</strong>
      </div>
      <div className="social-category-grid" aria-label={language === "tr" ? "Sosyal kategoriler" : "Social categories"}>
        {categories.map((item) => (
          <button
            key={item.id}
            className={category === item.id ? "active" : ""}
            onClick={() => setCategory(item.id)}
          >
            <Users size={17} />
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div className="social-directory-filters">
        <label className="member-search">
          <Search size={16} />
          <input
            value={query}
            placeholder={language === "tr" ? "Kullanici ara" : "Search people"}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <DirectorySelect
          label={language === "tr" ? "Ben takip ediyorum" : "I follow"}
          value={myFollow}
          onChange={(value) => setMyFollow(value as RelationshipFilter)}
          options={relationshipOptions(language)}
        />
        <DirectorySelect
          label={language === "tr" ? "Beni takip ediyor" : "Follows me"}
          value={followsMe}
          onChange={(value) => setFollowsMe(value as RelationshipFilter)}
          options={relationshipOptions(language)}
        />
        <DirectorySelect
          label={language === "tr" ? "Kaynak" : "Source"}
          value={source}
          onChange={(value) => setSource(value as typeof source)}
          options={[
            ["all", language === "tr" ? "Tumu" : "All"],
            ["direct", language === "tr" ? "Baglantilarim" : "My connections"],
            ["network", language === "tr" ? "Ag kesfi" : "Network discovery"],
          ]}
        />
        <DirectorySelect
          label={language === "tr" ? "Aktiflik verisi" : "Activity data"}
          value={activity}
          onChange={(value) => setActivity(value as typeof activity)}
          options={[
            ["any", language === "tr" ? "Fark etmez" : "Any"],
            ["known", language === "tr" ? "Taranmis" : "Scanned"],
            ["unknown", language === "tr" ? "Taranmamis" : "Not scanned"],
          ]}
        />
        <DirectorySelect
          label={language === "tr" ? "En az zevk puani" : "Minimum taste"}
          value={String(minTaste)}
          onChange={(value) => setMinTaste(Number(value))}
          options={[0, 40, 50, 60, 70, 80, 90].map((score) => [String(score), score ? `${score}+` : language === "tr" ? "Fark etmez" : "Any"])}
        />
        <DirectorySelect
          label={language === "tr" ? "En cok zevk puani" : "Maximum taste"}
          value={String(maxTaste)}
          onChange={(value) => setMaxTaste(Number(value))}
          options={[40, 50, 60, 70, 80, 90, 100].map((score) => [String(score), score === 100 ? language === "tr" ? "Fark etmez" : "Any" : String(score)])}
        />
        <DirectorySelect
          label={language === "tr" ? "Minimum aktiflik" : "Minimum activity"}
          value={String(minDirectoryActivity)}
          onChange={(value) => setMinDirectoryActivity(Number(value))}
          options={[0, 10, 25, 40, 60, 80].map((score) => [String(score), score ? `${score}+` : language === "tr" ? "Fark etmez" : "Any"])}
        />
        <DirectorySelect
          label={language === "tr" ? "Maksimum aktiflik" : "Maximum activity"}
          value={String(maxDirectoryActivity)}
          onChange={(value) => setMaxDirectoryActivity(Number(value))}
          options={[10, 25, 40, 60, 80, 100].map((score) => [String(score), score === 100 ? language === "tr" ? "Fark etmez" : "Any" : String(score)])}
        />
        <DirectorySelect
          label={language === "tr" ? "Min ortak baglanti" : "Min mutual links"}
          value={String(minDirectoryConnections)}
          onChange={(value) => setMinDirectoryConnections(Number(value))}
          options={[0, 1, 2, 5, 10, 20, 50].map((count) => [String(count), count ? `${count}+` : language === "tr" ? "Fark etmez" : "Any"])}
        />
        <DirectorySelect
          label={language === "tr" ? "Maks ortak baglanti" : "Max mutual links"}
          value={String(maxDirectoryConnections)}
          onChange={(value) => setMaxDirectoryConnections(Number(value))}
          options={[2, 5, 10, 20, 50, 100, 9999].map((count) => [String(count), count === 9999 ? language === "tr" ? "Fark etmez" : "Any" : String(count)])}
        />
        <DirectorySelect
          label={language === "tr" ? "Sirala" : "Sort"}
          value={sort}
          onChange={(value) => setSort(value as SocialDirectorySort)}
          options={[
            ["relationship", language === "tr" ? "Iliski onceligi" : "Relationship"],
            ["taste", language === "tr" ? "Zevk ve oneri puani" : "Taste and recommendation"],
            ["active", language === "tr" ? "En aktif" : "Most active"],
            ["inactive", language === "tr" ? "En uzun suredir pasif" : "Least active"],
            ["connections", language === "tr" ? "Ortak baglanti" : "Mutual links"],
            ["name", language === "tr" ? "Isim" : "Name"],
          ]}
        />
        <DirectorySelect
          label={language === "tr" ? "Sayfa boyutu" : "Page size"}
          value={String(pageSize)}
          onChange={(value) => setPageSize(Number(value))}
          options={[50, 100, 250].map((size) => [String(size), String(size)])}
        />
      </div>
      <div className="directory-summary">
        <span>
          {language === "tr"
            ? `${filtered.length} kisi filtreye uyuyor; ${activityKnown} kisinin aktifligi taranmis.`
            : `${filtered.length} people match; ${activityKnown} have activity data.`}
        </span>
        <button
          className="browser-scan-button"
          disabled={loading || !missingActivity.length}
          onClick={() => onLoadActivity(missingActivity.map((entry) => entry.username), missingActivityMembers)}
        >
          {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
          <span>
            {language === "tr"
              ? `Eksik ${missingActivity.length} kisinin aktifligini tamamla`
              : `Complete activity for ${missingActivity.length} people`}
          </span>
        </button>
      </div>
      {activityScanProgress && activityScanProgress.total > 0 && (
        <div className="activity-progress" aria-live="polite">
          <progress value={activityScanProgress.processed} max={activityScanProgress.total} />
          <span>
            {language === "tr"
              ? `${activityScanProgress.processed}/${activityScanProgress.total} denendi · ${activityScanProgress.loaded} alindi · ${activityScanProgress.failed} alinamadi. Her parti otomatik kaydedilir.`
              : `${activityScanProgress.processed}/${activityScanProgress.total} attempted · ${activityScanProgress.loaded} loaded · ${activityScanProgress.failed} failed. Every batch is saved automatically.`}
          </span>
        </div>
      )}
      <SocialActionWorkbench language={language} directory={directory} />
      <SocialDirectoryList entries={pagination.items} language={language} onSelectMatch={onSelectMatch} />
      {filtered.length > 0 && (
        <nav className="match-pagination directory-pagination">
          <button disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            <ArrowLeft size={16} />
            {language === "tr" ? "Onceki" : "Previous"}
          </button>
          <span>
            {pagination.start + 1}-{pagination.end} / {filtered.length} · {language === "tr" ? "Sayfa" : "Page"}{" "}
            {pagination.page}/{pagination.totalPages}
          </span>
          <button
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
          >
            {language === "tr" ? "Sonraki" : "Next"}
            <ArrowRight size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}

function SocialActionWorkbench({
  language,
  directory,
}: {
  language: Language;
  directory: SocialDirectoryEntry[];
}) {
  const [rule, setRule] = useState<SocialActionRule>({
    action: "unfollow",
    inactiveDays: 180,
    minTaste: 0,
    maxTaste: 55,
    minActivity: 0,
    maxActivity: 35,
    followsMe: "any",
  });
  const [expanded, setExpanded] = useState(false);
  const candidates = useMemo(() => buildSocialActionCandidates(directory, rule), [directory, rule]);

  function setAction(action: SocialAction) {
    setRule(
      action === "unfollow"
        ? { action, inactiveDays: 180, minTaste: 0, maxTaste: 55, minActivity: 0, maxActivity: 35, followsMe: "any" }
        : { action, inactiveDays: 0, minTaste: 70, maxTaste: 100, minActivity: 50, maxActivity: 100, followsMe: "any" },
    );
  }

  async function copyCandidates() {
    await navigator.clipboard.writeText(candidates.map(({ entry }) => `@${entry.username}`).join("\n"));
  }

  return (
    <div className="social-action-workbench" data-testid="social-action-workbench">
      <button className="workbench-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <Filter size={17} />
        <span>{language === "tr" ? "Takip islem kurallari" : "Follow action rules"}</span>
        <strong>{candidates.length}</strong>
        <ArrowRight className={expanded ? "rotate" : ""} size={17} />
      </button>
      {expanded && (
        <div className="workbench-body">
          <p>
            {language === "tr"
              ? "Kurallar yalnizca aday listesi uretir. Letterboxd toplu otomasyonu ve asiri takip davranisini kisitladigi icin hesap degisikligi otomatik yapilmaz."
              : "Rules only create a review queue. Letterboxd restricts bulk automation and excessive following, so account changes are never executed automatically."}
          </p>
          <div className="workbench-controls">
            <DirectorySelect
              label={language === "tr" ? "Islem" : "Action"}
              value={rule.action}
              onChange={(value) => setAction(value as SocialAction)}
              options={[
                ["unfollow", language === "tr" ? "Takipten cik adayi" : "Unfollow candidate"],
                ["follow", language === "tr" ? "Takip et adayi" : "Follow candidate"],
              ]}
            />
            <DirectorySelect
              label={language === "tr" ? "Pasiflik" : "Inactivity"}
              value={String(rule.inactiveDays)}
              onChange={(value) => setRule((current) => ({ ...current, inactiveDays: Number(value) }))}
              options={[0, 30, 90, 180, 365].map((days) => [
                String(days),
                days ? `${days}+ ${language === "tr" ? "gun" : "days"}` : language === "tr" ? "Fark etmez" : "Any",
              ])}
            />
            <DirectorySelect
              label={language === "tr" ? "En az zevk" : "Minimum taste"}
              value={String(rule.minTaste)}
              onChange={(value) => setRule((current) => ({ ...current, minTaste: Number(value) }))}
              options={[0, 40, 50, 60, 70, 80].map((score) => [String(score), score ? `${score}+` : language === "tr" ? "Fark etmez" : "Any"])}
            />
            <DirectorySelect
              label={language === "tr" ? "En cok zevk" : "Maximum taste"}
              value={String(rule.maxTaste)}
              onChange={(value) => setRule((current) => ({ ...current, maxTaste: Number(value) }))}
              options={[40, 50, 55, 60, 70, 100].map((score) => [String(score), score === 100 ? language === "tr" ? "Fark etmez" : "Any" : String(score)])}
            />
            <DirectorySelect
              label={language === "tr" ? "Beni takip ediyor" : "Follows me"}
              value={rule.followsMe}
              onChange={(value) => setRule((current) => ({ ...current, followsMe: value as SocialActionRule["followsMe"] }))}
              options={relationshipOptions(language)}
            />
            <DirectorySelect
              label={language === "tr" ? "Minimum aktiflik" : "Minimum activity"}
              value={String(rule.minActivity)}
              onChange={(value) => setRule((current) => ({ ...current, minActivity: Number(value) }))}
              options={[0, 10, 25, 40, 60, 80].map((score) => [String(score), score ? `${score}+` : language === "tr" ? "Fark etmez" : "Any"])}
            />
            <DirectorySelect
              label={language === "tr" ? "Maksimum aktiflik" : "Maximum activity"}
              value={String(rule.maxActivity)}
              onChange={(value) => setRule((current) => ({ ...current, maxActivity: Number(value) }))}
              options={[10, 25, 35, 50, 70, 100].map((score) => [String(score), score === 100 ? language === "tr" ? "Fark etmez" : "Any" : String(score)])}
            />
          </div>
          <div className="queue-header">
            <span>
              {language === "tr"
                ? `${candidates.length} aday bulundu; en fazla ilk 25 gosteriliyor.`
                : `${candidates.length} candidates; showing up to 25.`}
            </span>
            <button className="secondary-button" disabled={!candidates.length} onClick={copyCandidates}>
              <Copy size={15} />
              {language === "tr" ? "Kullanicilari kopyala" : "Copy handles"}
            </button>
          </div>
          <ul className="action-queue">
            {candidates.slice(0, 25).map(({ entry, reasons }) => (
              <li key={entry.username}>
                <Avatar name={entry.displayName} src={entry.avatarUrl} />
                <div>
                  <strong>{entry.displayName}</strong>
                  <span>@{entry.username} · {reasons.join(" · ")}</span>
                </div>
                <a
                  href={`https://letterboxd.com/${entry.username}/`}
                  target="_blank"
                  rel="noreferrer"
                  title={language === "tr" ? "Profili ac ve islemi onayla" : "Open profile and confirm"}
                >
                  <ExternalLink size={17} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SocialDirectoryList({
  entries,
  language,
  onSelectMatch,
}: {
  entries: SocialDirectoryEntry[];
  language: Language;
  onSelectMatch: (match: MatchResult) => void;
}) {
  if (!entries.length) return <p className="empty-state">0</p>;
  return (
    <ul className="social-directory-list">
      {entries.map((entry) => (
        <li key={entry.username}>
          <Avatar name={entry.displayName} src={entry.avatarUrl} />
          <div className="directory-person">
            <strong>{entry.displayName}</strong>
            <small>@{entry.username}</small>
            <span>{entry.activity ? formatActivity(entry.activity, language) : language === "tr" ? "Aktiflik henuz taranmadi" : "Activity not scanned yet"}</span>
          </div>
          <div className="relationship-badges">
            {entry.myFollow && <span className="relation-following">{language === "tr" ? "Takip ediyorum" : "Following"}</span>}
            {entry.followsMe && <span className="relation-follower">{language === "tr" ? "Beni takip ediyor" : "Follows me"}</span>}
            {entry.inNetwork && !entry.myFollow && !entry.followsMe && <span className="relation-network">{language === "tr" ? "Ag kesfi" : "Network"}</span>}
            {entry.isNewFollower && <span className="relation-new">{language === "tr" ? "Yeni" : "New"}</span>}
            {entry.isLostFollower && <span className="relation-lost">{language === "tr" ? "Cikmis" : "Lost"}</span>}
          </div>
          <div className="directory-score">
            {entry.match ? (
              <>
                <strong>{entry.match.recommendationScore}</strong>
                <small>{language === "tr" ? `zevk ${entry.match.score}` : `taste ${entry.match.score}`}</small>
              </>
            ) : entry.activity?.activityScore !== undefined ? (
              <>
                <strong>{entry.activity.activityScore}</strong>
                <small>{language === "tr" ? "aktiflik" : "activity"}</small>
              </>
            ) : null}
            {(entry.connections ?? 0) > 0 && <small>{entry.connections} {language === "tr" ? "ortak" : "links"}</small>}
          </div>
          {entry.match && (
            <button
              className="profile-arrow match-detail-button"
              onClick={() => onSelectMatch(entry.match!)}
              title={language === "tr" ? "Ortak filmleri ve puanlari ac" : "Open shared films and ratings"}
              aria-label={language === "tr" ? `${entry.displayName} zevk detayini ac` : `Open taste details for ${entry.displayName}`}
            >
              <Search size={18} />
            </button>
          )}
          <a
            className="profile-arrow"
            href={`https://letterboxd.com/${entry.username}/`}
            target="_blank"
            rel="noreferrer"
            title={language === "tr" ? "Letterboxd profilini ac" : "Open Letterboxd profile"}
            aria-label={language === "tr" ? `${entry.displayName} Letterboxd profilini ac` : `Open ${entry.displayName} on Letterboxd`}
          >
            <ExternalLink size={18} />
          </a>
        </li>
      ))}
    </ul>
  );
}

function DirectorySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option value={optionValue} key={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function relationshipOptions(language: Language): Array<readonly [string, string]> {
  return [
    ["any", language === "tr" ? "Fark etmez" : "Any"],
    ["yes", language === "tr" ? "Evet" : "Yes"],
    ["no", language === "tr" ? "Hayir" : "No"],
  ];
}

function directoryEntryToMember(entry: SocialDirectoryEntry): SocialMember {
  return {
    username: entry.username,
    displayName: entry.displayName,
    avatarUrl: entry.avatarUrl,
    connections: entry.connections,
    connectionWeight: entry.connectionWeight,
    via: entry.via,
    viaDetails: entry.viaDetails,
  };
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

function MatchCard({
  language,
  match,
  avatarUrl,
  onSelect,
}: {
  language: Language;
  match: MatchResult;
  avatarUrl?: string;
  onSelect: () => void;
}) {
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
    <article
      className="match-card"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
    >
      <div className="match-head">
        <div className="match-person">
          <Avatar name={match.user.displayName} src={avatarUrl} />
          <div>
            <h2>{match.user.displayName}</h2>
            <span>@{match.user.handle}</span>
            <small className="activity-line">
              {formatActivity(match.user, language)}
            </small>
          </div>
        </div>
        <div className="match-head-actions">
          <a
            className="profile-arrow"
            href={`https://letterboxd.com/${match.user.handle}/`}
            target="_blank"
            rel="noreferrer"
            title={language === "tr" ? "Letterboxd profilini ac" : "Open Letterboxd profile"}
            aria-label={language === "tr" ? `${match.user.displayName} Letterboxd profilini ac` : `Open ${match.user.displayName} on Letterboxd`}
            onClick={(event) => event.stopPropagation()}
          >
            <ExternalLink size={18} />
          </a>
          <div className="radial-score" style={{ "--score": `${match.recommendationScore}%` } as React.CSSProperties}>
            <strong>{match.recommendationScore}</strong>
            <small>{language === "tr" ? "oneri" : "rec."}</small>
          </div>
        </div>
      </div>

      <div className="match-metrics">
        <Metric label={language === "tr" ? "zevk skoru" : "taste score"} value={match.score} />
        <Metric label={language === "tr" ? "ortak puanli film" : "co-rated films"} value={match.commonCount} />
        <Metric label={t(language, "sharedLoves")} value={match.sharedLoves.length} />
        <Metric label={t(language, "sharedDislikes")} value={match.sharedDislikes.length} />
        <Metric label={t(language, "divergences")} value={match.divergences.length} />
        <Metric
          label={language === "tr" ? "ortak baglanti" : "mutual links"}
          value={match.user.networkConnections ?? 0}
        />
        <Metric label={language === "tr" ? "nislik" : "niche"} value={match.nicheScore} />
        <Metric label={language === "tr" ? "aktiflik" : "activity"} value={match.user.activityScore ?? 0} />
      </div>

      <p className="coverage-line">
        {language === "tr"
          ? `Oneri ${match.recommendationScore}; zevk ${match.score}. Adayin RSS akisinda ${match.candidateFilmCount} puanli film var; ${match.commonCount} filme ikiniz de puan vermissiniz. Ham uyum ${match.rawScore}; ${confidenceLabel} (%${match.confidence}).`
          : `Recommendation ${match.recommendationScore}; taste ${match.score}. The candidate has ${match.candidateFilmCount} rated RSS films; you both rated ${match.commonCount}. Raw affinity ${match.rawScore}; ${confidenceLabel} (${match.confidence}%).`}
      </p>

      <div className="reason-list">
        <strong>{t(language, "why")}</strong>
        {reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
      </div>

      {match.togetherPick && (
        <div className="together-pick">
          <span>
            {t(language, "together")}
            <small>
              {language === "tr"
                ? match.togetherPick.kind === "mutual-watchlist"
                  ? " Film ikinizin de watchlistinde. Bu bilgi ancak iki tarafta da watchlist verisi varsa bulunabilir."
                  : match.togetherPick.kind === "your-watchlist-they-loved"
                    ? ` Film senin watchlistinde; ${match.user.displayName} filme en az 4 vermis.`
                    : ` Film senin watchlistinde; ortak sevdiginiz filmlerin TMDB onerisi, anahtar kelime, yonetmen ve daha dusuk agirlikli tur sinyalleriyle eslesti. Uyum: %${match.togetherPick.fitScore ?? 0}.`
                : match.togetherPick.kind === "mutual-watchlist"
                  ? " The film is on both watchlists. This requires watchlist data from both people."
                  : match.togetherPick.kind === "your-watchlist-they-loved"
                    ? ` The film is on your watchlist and ${match.user.displayName} rated it at least 4.`
                    : ` The film is on your watchlist and matches shared-loved TMDB recommendations, keywords, directors and lower-weight genre signals. Fit: ${match.togetherPick.fitScore ?? 0}%.`}
            </small>
          </span>
          <strong>
            {match.togetherPick.film.title}
            {match.togetherPick.candidateRating !== undefined ? ` · ${formatRating(match.togetherPick.candidateRating)}` : ""}
          </strong>
        </div>
      )}
    </article>
  );
}

function MatchDetail({
  language,
  match,
  avatarUrl,
  onClose,
}: {
  language: Language;
  match: MatchResult;
  avatarUrl?: string;
  onClose: () => void;
}) {
  return (
    <div className="match-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="match-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${match.user.displayName} match details`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className="match-person">
            <Avatar name={match.user.displayName} src={avatarUrl} large />
            <div>
              <h2>{match.user.displayName}</h2>
              <span>@{match.user.handle} · {language === "tr" ? "oneri" : "recommended"} {match.recommendationScore}/100 · {language === "tr" ? "zevk" : "taste"} {match.score}/100</span>
              <small className="activity-line">{formatActivity(match.user, language)}</small>
            </div>
          </div>
          <div className="dialog-actions">
            <a
              href={`https://letterboxd.com/${match.user.handle}/`}
              target="_blank"
              rel="noreferrer"
              title={language === "tr" ? "Letterboxd profilini ac" : "Open Letterboxd profile"}
            >
              <ExternalLink size={18} />
            </a>
            <button onClick={onClose} title={language === "tr" ? "Kapat" : "Close"}>
              <X size={20} />
            </button>
          </div>
        </header>

        <p className="coverage-line">
          {language === "tr"
            ? `${match.commonCount} ortak puanli film, gecerlilik %${match.confidence}. Ham uyum ${match.rawScore}; toplu ayrisma cezasi -${match.divergencePenalty}; yerel nislik ${match.nicheScore}/100. Kanit azsa skor 50'ye yaklastirilir. Watchlist ve puansiz filmler hesaba katilmaz.`
            : `${match.commonCount} co-rated films, ${match.confidence}% validity. Raw affinity ${match.rawScore}; repeated-split penalty -${match.divergencePenalty}; local niche score ${match.nicheScore}/100. Sparse evidence pulls the score toward 50. Watchlist and unrated films are excluded.`}
        </p>

        {match.togetherPick && (
          <div className="together-pick detail-together-pick">
            <span>{language === "tr" ? "Birlikte izleyin" : "Watch together"}</span>
            <strong>{match.togetherPick.film.title}</strong>
            <small>
              {match.togetherPick.reason ||
                (match.togetherPick.kind === "mutual-watchlist"
                  ? language === "tr" ? "Film ikinizin de watchlistinde." : "The film is on both watchlists."
                  : match.togetherPick.kind === "your-watchlist-they-loved"
                    ? language === "tr" ? "Senin watchlistinde; bu kisi filmi sevdi." : "On your watchlist; this person loved it."
                    : language === "tr" ? "Ortak zevkinize en yakin watchlist adayi." : "The closest watchlist fit for your shared taste.")}
            </small>
          </div>
        )}

        <div className="detail-section">
          <h3>{language === "tr" ? "Ortak filmler ve puanlar" : "Common films and ratings"}</h3>
          <div className="rating-table">
            <div className="rating-row rating-head">
              <span>{language === "tr" ? "Film" : "Film"}</span>
              <span>{language === "tr" ? "Sen" : "You"}</span>
              <span>{match.user.displayName}</span>
              <span>{language === "tr" ? "Etki / agirlik" : "Impact / weight"}</span>
            </div>
            {match.commonFilms.map((item) => (
              <div className="rating-row" key={item.film.key}>
                <span>{item.film.title}</span>
                <strong>{formatRating(item.targetRating)}</strong>
                <strong>{formatRating(item.candidateRating)}</strong>
                <span className={item.impact >= 0 ? "positive-impact" : "negative-impact"}>
                  {item.impact >= 0 ? "+" : ""}{item.impact} · {item.discriminativeWeight.toFixed(2)}x
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="detail-split">
          <div className="detail-section">
            <h3>{language === "tr" ? "Ortak sevilenler" : "Shared loves"}</h3>
            <FilmList films={match.sharedLoves} />
          </div>
          <div className="detail-section">
            <h3>{language === "tr" ? "Ayrismalar" : "Divergences"}</h3>
            {match.divergences.length ? (
              <ul className="film-list">
                {match.divergences.map((item) => (
                  <li key={item.film.key}>
                    <span>{item.film.title}</span>
                    <small>{formatRating(item.targetRating)} / {formatRating(item.candidateRating)}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-line">{language === "tr" ? "Guclu bir ayrisma bulunmadi." : "No strong divergence found."}</p>
            )}
          </div>
        </div>

        {(match.user.connectionHandles?.length ?? 0) > 0 && (
          <div className="detail-section">
            <h3>
              {language === "tr"
                ? `Seni bu adaya baglayan ${match.user.connectionHandles?.length} kisi`
                : `${match.user.connectionHandles?.length} people connecting you to this candidate`}
            </h3>
            <p className="muted-line">
              {language === "tr"
                ? "Bunlar senin takip ettigin ve bu adayi da takip eden hesaplardir."
                : "These are accounts you follow that also follow this candidate."}
            </p>
            <div className="connection-list">
              {(match.user.connectionDetails?.length
                ? match.user.connectionDetails
                : match.user.connectionHandles?.map((handle) => ({
                    handle,
                    displayName: handle,
                    avatarUrl: undefined,
                    followingCount: undefined,
                    weight: 0,
                  })) ?? []
              ).map((connection) => (
                <a
                  href={`https://letterboxd.com/${connection.handle}/`}
                  target="_blank"
                  rel="noreferrer"
                  key={connection.handle}
                  title={
                    connection.followingCount !== undefined
                      ? `${connection.followingCount} following · ${connection.weight.toFixed(3)} weight`
                      : undefined
                  }
                >
                  <Avatar name={connection.displayName} src={connection.avatarUrl} />
                  <span>
                    <strong>{connection.displayName}</strong>
                    <small>@{connection.handle}</small>
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Avatar({ name, src, large = false }: { name: string; src?: string; large?: boolean }) {
  return src ? (
    <img className={`profile-avatar${large ? " large" : ""}`} src={src} alt="" loading="lazy" />
  ) : (
    <span className={`profile-avatar avatar-fallback${large ? " large" : ""}`}>{name.slice(0, 1).toUpperCase()}</span>
  );
}

function formatRating(rating?: number) {
  return rating === undefined ? "—" : `${rating.toFixed(rating % 1 ? 1 : 0)} ★`;
}

function formatActivity(user: UserTaste, language: Language) {
  if (!user.lastActivityAt) {
    return language === "tr" ? "Son film etkinligi bilinmiyor" : "Last film activity unknown";
  }
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(user.lastActivityAt)) / (24 * 60 * 60 * 1000)));
  const relative =
    language === "tr"
      ? days === 0
        ? "bugun"
        : days === 1
          ? "1 gun once"
          : days < 60
            ? `${days} gun once`
            : `${Math.floor(days / 30)} ay once`
      : days === 0
        ? "today"
        : days === 1
          ? "1 day ago"
          : days < 60
            ? `${days} days ago`
            : `${Math.floor(days / 30)} months ago`;
  return language === "tr"
    ? `Son film etkinligi ${relative} · 30 gunde ${user.activity30Days ?? 0}`
    : `Last film activity ${relative} · ${user.activity30Days ?? 0} in 30 days`;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function NumberFilter({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="number-filter">
      <span>{label}</span>
      <div>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
        />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
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
        ? match.togetherPick.kind === "mutual-watchlist"
          ? `Ikimizin da watchlistinde: ${match.togetherPick.film.title}.`
          : `Senin watchlistinde, ${match.user.displayName} tarafindan yuksek puanlanmis: ${match.togetherPick.film.title}.`
        : match.togetherPick.kind === "mutual-watchlist"
          ? `On both watchlists: ${match.togetherPick.film.title}.`
          : `On your watchlist and highly rated by ${match.user.displayName}: ${match.togetherPick.film.title}.`,
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
  type FollowerSnapshot = {
    checkedAt: string;
    followers: SocialMember[];
    scanStage?: AvailableSocialData["scanStage"];
    comparisonPreviousCheckedAt?: string;
    lostFollowers?: SocialMember[];
    newFollowers?: SocialMember[];
    history?: AvailableSocialData["history"];
  };
  let previous: FollowerSnapshot | undefined;
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
      history: previous?.history ?? [],
    };
  }

  const currentNames = new Set(payload.followers.map((member) => member.username.toLowerCase()));
  const sameFollowers =
    previous?.followers.length === payload.followers.length &&
    previous.followers.every((member) => currentNames.has(member.username.toLowerCase()));
  if (
    payload.scanStage === "network-complete" &&
    previous?.scanStage === "social-complete" &&
    sameFollowers
  ) {
    const history = [...(previous.history ?? [])];
    const latest = history[history.length - 1];
    if (latest) latest.networkCandidates = payload.network?.candidateCount;
    const snapshot: FollowerSnapshot = {
      ...previous,
      checkedAt: payload.checkedAt,
      scanStage: "network-complete",
      history,
    };
    localStorage.setItem(key, JSON.stringify(snapshot));
    return {
      ...payload,
      previousCheckedAt: previous.comparisonPreviousCheckedAt,
      lostFollowers: previous.lostFollowers ?? [],
      newFollowers: previous.newFollowers ?? [],
      history,
    };
  }

  const previousNames = new Set((previous?.followers ?? []).map((member) => member.username.toLowerCase()));
  const lostFollowers = previous?.followers.filter((member) => !currentNames.has(member.username.toLowerCase())) ?? [];
  const newFollowers = previous
    ? payload.followers.filter((member) => !previousNames.has(member.username.toLowerCase()))
    : [];
  const history = [
    ...(previous?.history ?? []),
    {
      checkedAt: payload.checkedAt,
      following: payload.counts.following,
      followers: payload.counts.followers,
      mutuals: payload.counts.mutuals,
      newFollowers: newFollowers.length,
      lostFollowers: lostFollowers.length,
      networkCandidates: payload.network?.candidateCount,
    },
  ].slice(-50);

  localStorage.setItem(key, JSON.stringify({
    checkedAt: payload.checkedAt,
    followers: payload.followers,
    scanStage: payload.scanStage,
    comparisonPreviousCheckedAt: previous?.checkedAt,
    lostFollowers,
    newFollowers,
    history,
  } satisfies FollowerSnapshot));
  return {
    ...payload,
    previousCheckedAt: previous?.checkedAt,
    lostFollowers,
    newFollowers,
    history,
  };
}

function loadStoredUsers(): UserTaste[] {
  try {
    const value = JSON.parse(localStorage.getItem("tastetwin.users") ?? "[]");
    return Array.isArray(value) ? value.map(deriveUserActivity) : [];
  } catch {
    return [];
  }
}

function deriveUserActivity(user: UserTaste): UserTaste {
  if (user.lastActivityAt && user.activityScore !== undefined) return user;
  const dates = user.films
    .flatMap((film) => [film.activityDate, ...film.watchedDates])
    .map((value) => Date.parse(value ?? ""))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  if (!dates.length) return { ...user, activity30Days: 0, activity90Days: 0, activityScore: 0 };
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const activity30Days = dates.filter((date) => now - date <= 30 * day).length;
  const activity90Days = dates.filter((date) => now - date <= 90 * day).length;
  const recencyDays = Math.max(0, (now - dates[0]) / day);
  const recencyScore = Math.max(0, 100 - recencyDays * 2);
  const frequencyScore = Math.min(100, activity30Days * 12 + activity90Days * 3);
  return {
    ...user,
    lastActivityAt: new Date(dates[0]).toISOString(),
    activity30Days,
    activity90Days,
    activityScore: Math.round(recencyScore * 0.65 + frequencyScore * 0.35),
  };
}

function mergeRssUsers(current: UserTaste[], incoming: UserTaste[]) {
  const uploaded = current.filter((user) => user.source !== "rss");
  const rss = new Map(
    current
      .filter((user) => user.source === "rss")
      .map((user) => [user.handle.toLowerCase(), user]),
  );
  for (const user of incoming) {
    rss.set(user.handle.toLowerCase(), deriveUserActivity(user));
  }
  return [...uploaded, ...rss.values()];
}

function loadStoredSocial(): Record<string, SocialData> {
  try {
    const value = JSON.parse(localStorage.getItem("tastetwin.social") ?? "{}");
    for (const data of Object.values(value) as SocialData[]) {
      if (!data.available) continue;
      data.lostFollowers ??= [];
      data.newFollowers ??= [];
      data.history ??= [];
    }
    return value;
  } catch {
    return {};
  }
}
