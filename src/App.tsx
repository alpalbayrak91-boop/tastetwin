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
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "./i18n";
import { version as appVersion } from "../package.json";
import { version as extensionVersion } from "../extension/manifest.json";
import { WatchTogetherPanel } from "./components/WatchTogetherPanel";
import { socialDirectoryCsv } from "./lib/social-export";
import { pickRatingsTargets, scrapedMembersToUsers, type RatingsScope, type ScrapedMember } from "./lib/full-ratings";
import {
  buildFilmCatalog,
  defaultFilmPeopleOptions,
  filmPeopleCsv,
  findPeopleByFilms,
  searchFilmCatalog,
  type FilmCondition,
  type FilmCriterion,
  type FilmPeopleOptions,
} from "./lib/film-people";
import { computeFollowerChanges, followerEventsCsv, summarizeFollowerEvents, type FollowerEvent, type FollowerSnapshot } from "./lib/follower-history";
import { togetherPickReason } from "./lib/watch-together";
import {
  archiveCsv,
  archiveFacet,
  buildNetworkRatings,
  defaultArchiveFilters,
  filterArchive,
  watchedYears,
  type ArchiveFilters,
  type ArchiveSort,
  type ArchiveStatus,
} from "./lib/archive-filters";
import { readLetterboxdExport } from "./lib/letterboxd";
import { mergeFilmArchive, preserveFilmMetadata } from "./lib/film-archive";
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
  isWatched,
  pickNextWatch,
  type NextWatchMode,
} from "./lib/film-insights";
import { buildMatchesAsync, buildRecommendations, decadeTerms, getStats, topTerms } from "./lib/taste";
import type { FilmSignal, Language, MatchResult, UserTaste } from "./types";

type Tab = "overview" | "matches" | "social" | "profile";

type SocialMember = SocialMemberRecord;

type SocialManagementQueues = {
  follow: string[];
  unfollow: string[];
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
      liveUpdatedAt?: string;
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
      /** Name-level follower changes across every complete scan, newest last. */
      followerEvents?: FollowerEvent[];
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
  managementQueuesByHandle: Record<string, SocialManagementQueues>;
};

type TasteTwinBackup = {
  format: "tastetwin-backup";
  schemaVersion: 1;
  appVersion: string;
  exportedAt: string;
  state: PersistentAppState;
  /** Follower comparison baselines; optional so pre-0.6 backups still restore. */
  followerBaselines?: Record<string, unknown>;
};

type FullRefreshStep = {
  id: "own" | "scan" | "activity" | "ratings" | "tmdb" | "backup";
  state: "pending" | "running" | "done" | "failed" | "skipped";
};

type CloudBackupStatus = {
  folder?: string;
  folderAvailable: boolean;
  backupDirectory?: string;
  latest?: { savedAt: string; bytes: number };
  candidates: Array<{ provider: string; folder: string }>;
};

const FOLLOWER_BASELINE_PREFIX = "tastetwin.followers.";
const CLOUD_BACKUP_DELAY_MS = 60 * 1000;
const FULL_REFRESH_RATINGS_MEMBERS = 40;
const FULL_REFRESH_RATINGS_PAGES = 6;
const appRequestHeaders = { "Content-Type": "application/json", "X-TasteTwin-Request": "app" };

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
  const [profileQuery, setProfileQuery] = useState("");
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
  const [managementQueuesByHandle, setManagementQueuesByHandle] = useState<Record<string, SocialManagementQueues>>({});
  const [cloudBackup, setCloudBackup] = useState<CloudBackupStatus>();
  const [cloudFolderInput, setCloudFolderInput] = useState("");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudAuto, setCloudAuto] = useState(() => localStorage.getItem("tastetwin.cloudAuto") !== "off");
  // Folder this computer has already synced with. Until then automatic backups
  // stay off, so a fresh install never overwrites another computer's backup.
  const [cloudLinked, setCloudLinked] = useState(() => localStorage.getItem("tastetwin.cloudLinked") ?? "");
  const [fullRefresh, setFullRefresh] = useState<{ running: boolean; steps: FullRefreshStep[]; startedAt: number }>();
  const [fullRefreshBackupRequest, setFullRefreshBackupRequest] = useState(0);
  const [ratingsScan, setRatingsScan] = useState<{ running: boolean; text: string; members: number; loaded: number }>();
  const socialByHandleRef = useRef(socialByHandle);
  socialByHandleRef.current = socialByHandle;
  const usersRef = useRef(users);
  usersRef.current = users;
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
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
        if (cancelled) return;
        if (!saved) { setStorageReady(true); return; }
        if (Array.isArray(saved.users)) setUsers(saved.users.map(deriveUserActivity));
        if (typeof saved.activeId === "string") setActiveId(saved.activeId);
        if (typeof saved.accountHandle === "string") setAccountHandle(saved.accountHandle);
        if (saved.socialByHandle && typeof saved.socialByHandle === "object") setSocialByHandle(saved.socialByHandle);
        if (saved.managementQueuesByHandle && typeof saved.managementQueuesByHandle === "object") {
          setManagementQueuesByHandle(saved.managementQueuesByHandle);
        } else if (typeof saved.accountHandle === "string" && saved.accountHandle) {
          try {
            const legacy = JSON.parse(localStorage.getItem(`tastetwin.socialQueues.${saved.accountHandle}`) ?? "null");
            if (Array.isArray(legacy?.follow) && Array.isArray(legacy?.unfollow)) {
              setManagementQueuesByHandle({ [saved.accountHandle]: legacy });
              localStorage.removeItem(`tastetwin.socialQueues.${saved.accountHandle}`);
            }
          } catch {
            // Ignore malformed pre-0.4 queue data.
          }
        }
        if (!cancelled) setStorageReady(true);
      })
      .catch((error) => {
        console.warn("TasteTwin IndexedDB restore failed", error);
        if (!cancelled) setStatus("Yerel veri açılamadı. Verinin üzerine yazılmadı; diğer TasteTwin pencerelerini kapatıp yeniden aç. / Local data could not be opened; close other TasteTwin windows and reopen.");
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
      managementQueuesByHandle,
    })
      .then(() => {
        localStorage.removeItem("tastetwin.users");
        localStorage.removeItem("tastetwin.social");
      })
      .catch((error) => {
        console.warn("TasteTwin IndexedDB save failed", error);
        setStatus("Veri kaydedilemedi; uygulamayı kapatmadan yedek dışa aktar. / Data could not be saved; export a backup before closing.");
      });
  }, [users, activeId, accountHandle, socialByHandle, managementQueuesByHandle, storageReady]);

  useEffect(() => {
    async function receiveBrowserScan(event: MessageEvent) {
      if (event.origin !== "https://letterboxd.com" || event.data?.type !== "TASTETWIN_SOCIAL") return;
      const payload = socialFromBrowserMessage(event.data);
      if (!payload) return;
      const enriched = addFollowerChanges(payload.handle, payload, socialByHandleRef.current[payload.handle]);
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

  useEffect(() => {
    const ownerHandle = accountHandle || activeUser?.handle;
    if (!ownerHandle) return;
    let stopped = false;
    let since = new Date().toISOString();
    async function pullRelationshipEvents() {
      try {
        const response = await fetch(`/api/letterboxd/relationship-events?since=${encodeURIComponent(since)}`);
        const payload = await response.json();
        const events = Array.isArray(payload.events) ? payload.events : [];
        for (const event of events) {
          if (stopped || typeof event?.occurredAt !== "string") continue;
          since = event.occurredAt;
          setSocialByHandle((current) => {
            const social = current[ownerHandle];
            if (!social?.available) return current;
            return { ...current, [ownerHandle]: applyRelationshipEvent(social, event.handle, event.action) };
          });
          setStatus(
            language === "tr"
              ? `Canli guncelleme: @${event.handle} ${event.action === "follow" ? "takip listesine eklendi" : "takip listesinden cikarildi"}.`
              : `Live update: @${event.handle} was ${event.action === "follow" ? "added to" : "removed from"} following.`,
          );
        }
      } catch {
        // The desktop bridge can be briefly unavailable during app restarts.
      }
    }
    const timer = window.setInterval(pullRelationshipEvents, 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [accountHandle, activeUser?.handle, language]);

  async function handleUpload(file?: File) {
    if (!file || !storageReady) return;
    setStatus("");
    try {
      const imported = deriveUserActivity(preserveFilmMetadata(await readLetterboxdExport(file, accountHandle), uploadedUser));
      const nextUsers = [imported, ...users.filter((user) => user.source !== "upload")];
      await savePersistentState<PersistentAppState>(PERSISTENT_STATE_KEY, {
        users: nextUsers,
        activeId: imported.id,
        accountHandle,
        socialByHandle,
        managementQueuesByHandle,
      });
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

  async function refreshOwnActivity() {
    const handle = (uploadedUser?.handle || accountHandle).trim().toLowerCase();
    if (!handle || loading || !storageReady) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/letterboxd/rss?handles=${encodeURIComponent(handle)}`);
      const payload = await response.json();
      const incoming = payload.users?.[0] as UserTaste | undefined;
      if (!response.ok || !incoming) throw new Error(payload.errors?.[0]?.message || "RSS unavailable");
      setUsers(current => {
        const previous = current.find(user => user.handle.toLowerCase() === handle && user.source === "upload")
          ?? current.find(user => user.handle.toLowerCase() === handle);
        const refreshed = deriveUserActivity(mergeFilmArchive(previous, incoming));
        return [refreshed, ...current.filter(user => user.id !== refreshed.id)];
      });
      setStatus(language === "tr"
        ? `${incoming.films.length} yakın tarihli film kaydı arşivle birleştirildi. RSS tam geçmişi ve watchlist değişikliklerini kapsamaz; bunlar için güncel ZIP yükle.`
        : `${incoming.films.length} recent film records merged into the archive. RSS does not cover your full history or watchlist changes; upload a fresh ZIP for those.`);
    } catch (error) {
      setStatus(language === "tr" ? `Son aktivite alınamadı: ${String(error)}` : `Could not refresh activity: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  function buildBackup(): TasteTwinBackup {
    const followerBaselines: Record<string, unknown> = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(FOLLOWER_BASELINE_PREFIX)) continue;
      try {
        followerBaselines[key.slice(FOLLOWER_BASELINE_PREFIX.length)] = JSON.parse(localStorage.getItem(key) ?? "null");
      } catch {
        // A damaged baseline is rebuilt from the saved social scan.
      }
    }
    return {
      format: "tastetwin-backup",
      schemaVersion: 1,
      appVersion,
      exportedAt: new Date().toISOString(),
      state: {
        users,
        activeId,
        accountHandle,
        socialByHandle,
        managementQueuesByHandle,
      },
      followerBaselines,
    };
  }

  function exportLocalBackup() {
    const backup = buildBackup();
    const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tastetwin-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(
      language === "tr"
        ? `Yerel yedek hazirlandi: ${users.length} profil ve ${Object.keys(socialByHandle).length} sosyal hesap kaydi. TMDB tokeni guvenlik icin eklenmedi.`
        : `Local backup created with ${users.length} profiles and ${Object.keys(socialByHandle).length} social account records. The TMDB token was excluded for safety.`,
    );
  }

  async function importLocalBackup(file?: File) {
    if (!file || !storageReady) return;
    try {
      if (file.size > 250 * 1024 * 1024) throw new Error("backup_too_large");
      await restoreBackup(JSON.parse(await file.text()) as Partial<TasteTwinBackup>);
    } catch {
      setStatus(
        language === "tr"
          ? "Bu dosya gecerli bir TasteTwin yedegi degil veya okunamayacak kadar buyuk."
          : "This is not a valid TasteTwin backup or it is too large to read.",
      );
    }
  }

  async function restoreBackup(backup: Partial<TasteTwinBackup>) {
    const state = backup.state;
    if (
      backup.format !== "tastetwin-backup" ||
      backup.schemaVersion !== 1 ||
      !state ||
      !Array.isArray(state.users) ||
      typeof state.socialByHandle !== "object"
    ) {
      throw new Error("invalid_backup");
    }
    const restoredUsers = state.users.map(deriveUserActivity);
    const restoredActiveId = typeof state.activeId === "string" && restoredUsers.some((user) => user.id === state.activeId)
      ? state.activeId : restoredUsers[0]?.id ?? "";
    const restoredHandle = typeof state.accountHandle === "string" ? state.accountHandle : "";
    await savePersistentState<PersistentAppState>(PERSISTENT_STATE_KEY, {
      users: restoredUsers,
      activeId: restoredActiveId,
      accountHandle: restoredHandle,
      socialByHandle: state.socialByHandle ?? {},
      managementQueuesByHandle: state.managementQueuesByHandle ?? {},
    });
    setUsers(restoredUsers);
    setActiveId(restoredActiveId);
    setAccountHandle(restoredHandle);
    setSocialByHandle(state.socialByHandle ?? {});
    setManagementQueuesByHandle(state.managementQueuesByHandle ?? {});
    if (backup.followerBaselines && typeof backup.followerBaselines === "object") {
      for (const [handle, baseline] of Object.entries(backup.followerBaselines)) {
        if (/^[a-z0-9_-]{1,32}$/.test(handle) && baseline && typeof baseline === "object") {
          localStorage.setItem(`${FOLLOWER_BASELINE_PREFIX}${handle}`, JSON.stringify(baseline));
        }
      }
    }
    setTab("overview");
    setStatus(
      language === "tr"
        ? `Yedek geri yuklendi: ${restoredUsers.length} profil. Veriler bu bilgisayardaki uygulama deposuna kaydedildi.`
        : `Backup restored: ${restoredUsers.length} profiles. Data has been saved to this computer's app storage.`,
    );
  }

  useEffect(() => {
    fetch("/api/system/cloud-backup", { headers: appRequestHeaders })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((status: CloudBackupStatus | undefined) => {
        if (!status) return;
        setCloudBackup(status);
        setCloudFolderInput(status.folder ?? status.candidates[0]?.folder ?? "");
      })
      .catch(() => undefined);
  }, []);

  async function saveCloudFolder(folder: string) {
    setCloudBusy(true);
    try {
      const response = await fetch("/api/system/cloud-backup/config", { method: "POST", headers: appRequestHeaders, body: JSON.stringify({ folder }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setCloudBackup(payload);
      setStatus(
        folder
          ? language === "tr"
            ? `Bulut yedek klasoru ayarlandi: ${payload.backupDirectory}. Senkron uygulaman (Google Drive, OneDrive...) bu klasoru buluta yukler.`
            : `Cloud backup folder set: ${payload.backupDirectory}. Your sync app (Google Drive, OneDrive...) uploads it.`
          : language === "tr" ? "Bulut yedegi kapatildi." : "Cloud backup turned off.",
      );
      if (folder && !payload.latest) {
        await backupToCloud(true, payload.folder);
      } else if (folder) {
        setStatus(
          language === "tr"
            ? `Bu klasorde ${new Date(payload.latest.savedAt).toLocaleString("tr-TR")} tarihli bir yedek var. Baska bilgisayardan geliyorsa "Buluttan geri yukle", bu bilgisayardaki veri daha yeniyse "Simdi yedekle" sec.`
            : `This folder already has a backup from ${new Date(payload.latest.savedAt).toLocaleString("en-US")}. Use "Restore from cloud" if it came from another computer, or "Back up now" if this computer's data is newer.`,
        );
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setStatus(
        language === "tr"
          ? code === "folder_not_found" ? "Bu klasor bulunamadi. Tam yolu yaz (or. G:\\My Drive)." : "Klasor kaydedilemedi; tam yol yazmalisin."
          : code === "folder_not_found" ? "Folder not found. Enter the full path (e.g. G:\\My Drive)." : "Folder could not be saved; enter a full path.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function backupToCloud(quiet = false, folder = cloudBackup?.folder) {
    try {
      const response = await fetch("/api/system/cloud-backup", { method: "POST", headers: appRequestHeaders, body: JSON.stringify(buildBackup()) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setCloudBackup((current) => current && { ...current, latest: { savedAt: payload.savedAt, bytes: payload.bytes } });
      markCloudLinked(folder);
      if (!quiet) {
        setStatus(language === "tr" ? `Bulut klasorune yedeklendi: ${payload.directory}` : `Backed up to the cloud folder: ${payload.directory}`);
      }
    } catch {
      setStatus(
        language === "tr"
          ? "Bulut klasorune yedek yazilamadi. Klasor hala var mi, disk dolu mu kontrol et."
          : "Could not write the cloud-folder backup. Check that the folder still exists and has space.",
      );
    }
  }

  async function restoreFromCloud() {
    const confirmed = window.confirm(
      language === "tr"
        ? "Bulut klasorundeki son yedek bu bilgisayardaki TasteTwin verisinin yerine gecsin mi?"
        : "Replace this computer's TasteTwin data with the latest backup from the cloud folder?",
    );
    if (!confirmed) return;
    setCloudBusy(true);
    try {
      const response = await fetch("/api/system/cloud-backup/latest", { headers: appRequestHeaders });
      if (!response.ok) throw new Error("backup_not_found");
      await restoreBackup(await response.json());
      markCloudLinked(cloudBackup?.folder);
    } catch {
      setStatus(language === "tr" ? "Bulut klasorunde gecerli bir TasteTwin yedegi bulunamadi." : "No valid TasteTwin backup found in the cloud folder.");
    } finally {
      setCloudBusy(false);
    }
  }

  useEffect(() => {
    if (fullRefreshBackupRequest) void backupToCloud(true);
  }, [fullRefreshBackupRequest]);

  function markCloudLinked(folder = "") {
    localStorage.setItem("tastetwin.cloudLinked", folder);
    setCloudLinked(folder);
  }

  // Back up after changes settle, so a long scan writes once instead of every few seconds.
  useEffect(() => {
    if (!storageReady || !cloudAuto || !cloudBackup?.folder || cloudLinked !== cloudBackup.folder || !users.length) return;
    const timer = window.setTimeout(() => void backupToCloud(true), CLOUD_BACKUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [users, socialByHandle, managementQueuesByHandle, storageReady, cloudAuto, cloudBackup?.folder, cloudLinked]);

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
      const enriched = addFollowerChanges(handle, payload, socialByHandleRef.current[handle]);
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

  async function openLetterboxdAndScan(resume = false): Promise<boolean> {
    const handle = (accountHandle || activeUser?.handle || "").trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(handle)) {
      setStatus(language === "tr" ? "Once Letterboxd kullanici adini yaz." : "Enter your Letterboxd handle first.");
      return false;
    }
    setAccountHandle(handle);
    setStatus(
      language === "tr"
        ? resume
          ? "Chrome aciliyor; tarama kaldigi yerden devam edecek."
          : "Chrome aciliyor; eklenti otomatik taramayi baslatacak."
        : resume
          ? "Opening Chrome; the scan will resume where it stopped."
          : "Opening Chrome; the extension will start automatically.",
    );
    try {
      const response = await fetch("/api/extension/request-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-TasteTwin-Request": "app" },
        body: JSON.stringify({ handle, resume }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "scan_request_failed");
      window.open(`https://letterboxd.com/${encodeURIComponent(handle)}/`, "_blank", "noopener,noreferrer");
      return await waitForRequestedScan(handle, payload.requestedAt);
    } catch (error) {
      console.error(error);
      setStatus(language === "tr" ? "Otomatik tarama emri verilemedi." : "Could not request automatic scanning.");
      return false;
    }
  }

  /** Merge member film pages the extension saved into the local archive. */
  async function loadScrapedRatings(since?: string) {
    try {
      const query = since ? `?since=${encodeURIComponent(since)}` : "";
      const response = await fetch(`/api/letterboxd/film-ratings${query}`);
      if (!response.ok) return 0;
      const payload = (await response.json()) as { members?: ScrapedMember[] };
      const incoming = scrapedMembersToUsers(payload.members ?? [], usersRef.current, accountHandle || activeUser?.handle || "");
      if (incoming.length) setUsers((current) => mergeRssUsers(current, incoming));
      return incoming.length;
    } catch {
      return 0;
    }
  }

  function ratingsTargetsFor(scope: RatingsScope, limit: number) {
    const handle = (accountHandle || activeUser?.handle || "").toLowerCase();
    const social = socialByHandleRef.current[handle];
    const members = social?.available
      ? scope === "following" ? social.following
        : scope === "mutuals" ? social.mutuals
          : scope === "followers" ? social.followers
            : scope === "directory" ? [...social.following, ...social.followers, ...(social.networkCandidates ?? [])]
              : []
      : [];
    const candidates = scope === "matches"
      ? [...matchesRef.current].sort((a, b) => b.recommendationScore - a.recommendationScore)
        .map((match, index, list) => ({ handle: match.user.handle, rank: list.length - index }))
      : members.map((member, index) => ({ handle: member.username, rank: members.length - index }));
    return pickRatingsTargets(candidates.filter((candidate) => candidate.handle.toLowerCase() !== handle), usersRef.current, limit);
  }

  // Opens your Letterboxd profile; the extension claims the request there and
  // reads each member's film pages. Finished members are merged as they arrive.
  async function requestRatingsScan(handles: string[], maxPages: number): Promise<boolean> {
    const owner = (accountHandle || activeUser?.handle || "").trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(owner) || !handles.length) return false;
    const tr = language === "tr";
    setRatingsScan({ running: true, text: tr ? "Letterboxd aciliyor; eklenti puan sayfalarini okuyacak." : "Opening Letterboxd; the extension will read rating pages.", members: handles.length, loaded: 0 });
    try {
      const response = await fetch("/api/extension/request-ratings", {
        method: "POST",
        headers: appRequestHeaders,
        body: JSON.stringify({ handle: owner, handles, maxPages }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "ratings_request_failed");
      window.open(`https://letterboxd.com/${encodeURIComponent(owner)}/`, "_blank", "noopener,noreferrer");
      const requestedAt = payload.requestedAt as string;
      const startupDeadline = Date.now() + 3 * 60 * 1000;
      let sawLive = false;
      let loaded = 0;
      while (true) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        loaded += await loadScrapedRatings(requestedAt);
        const progress = await readScanProgress(owner);
        const current = progress?.mode === "ratings" && Date.parse(progress.updatedAt ?? "") >= Date.parse(requestedAt) ? progress : undefined;
        if (current?.live) sawLive = true;
        setRatingsScan({ running: true, text: current?.text ?? (tr ? "Eklentinin baslamasi bekleniyor..." : "Waiting for the extension..."), members: handles.length, loaded });
        if (current?.state === "complete") {
          loaded += await loadScrapedRatings(requestedAt);
          setRatingsScan({ running: false, text: current.text ?? "", members: handles.length, loaded });
          return true;
        }
        if (current && ["error", "cancelled", "interrupted"].includes(current.state) || (sawLive && current?.stalled)) {
          setRatingsScan({ running: false, text: `${current?.text ?? ""} ${current?.hint ?? ""}`.trim(), members: handles.length, loaded });
          return false;
        }
        if (!sawLive && Date.now() > startupDeadline) {
          setRatingsScan({ running: false, text: tr ? "Eklenti baslamadi. Eklentiyi 0.6.0'a guncelle ve Letterboxd sekmesini yenile." : "The extension did not start. Update it to 0.6.0 and refresh the Letterboxd tab.", members: handles.length, loaded });
          return false;
        }
      }
    } catch (error) {
      console.error(error);
      setRatingsScan({ running: false, text: tr ? "Puan taramasi istenemedi." : "Could not request the ratings scan.", members: handles.length, loaded: 0 });
      return false;
    }
  }

  useEffect(() => {
    if (storageReady) void loadScrapedRatings();
  }, [storageReady]);

  // One button for everything TasteTwin can collect. Each step is independent:
  // a failed scan still lets the remaining steps refresh what is already known.
  async function runFullRefresh() {
    if (fullRefresh?.running) return;
    const steps: FullRefreshStep[] = [
      { id: "own", state: "pending" },
      { id: "scan", state: "pending" },
      { id: "activity", state: "pending" },
      { id: "ratings", state: "pending" },
      { id: "tmdb", state: tmdbToken.trim() ? "pending" : "skipped" },
      { id: "backup", state: cloudBackup?.folder ? "pending" : "skipped" },
    ];
    const update = (id: FullRefreshStep["id"], state: FullRefreshStep["state"]) => {
      const index = steps.findIndex((step) => step.id === id);
      steps[index] = { ...steps[index], state };
      setFullRefresh({ running: true, steps: [...steps], startedAt: Date.now() });
    };
    setFullRefresh({ running: true, steps: [...steps], startedAt: Date.now() });
    update("own", "running");
    await refreshOwnActivity();
    update("own", "done");
    update("scan", "running");
    update("scan", (await openLetterboxdAndScan(false)) ? "done" : "failed");
    update("activity", "running");
    await useNetworkAsMatchCandidates();
    update("activity", "done");
    // Matches are recalculated after the activity step; give that a moment.
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
    const ratingsTargets = ratingsTargetsFor("matches", FULL_REFRESH_RATINGS_MEMBERS);
    if (ratingsTargets.length) {
      update("ratings", "running");
      update("ratings", (await requestRatingsScan(ratingsTargets, FULL_REFRESH_RATINGS_PAGES)) ? "done" : "failed");
    } else {
      update("ratings", "skipped");
    }
    if (steps.find((step) => step.id === "tmdb")?.state === "pending") {
      update("tmdb", "running");
      await enrichWithTmdb();
      update("tmdb", "done");
    }
    if (steps.find((step) => step.id === "backup")?.state === "pending") {
      update("backup", "running");
      // Wait a moment so the last state updates are in the backup.
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      setFullRefreshBackupRequest(Date.now());
      update("backup", "done");
    }
    setFullRefresh({ running: false, steps: [...steps], startedAt: Date.now() });
  }

  // A full network scan can run for hours, so this loop never times out on a
  // clock alone. It stops when the extension reports failure, or when the
  // extension stops heartbeating (the tab died) with no progress at all.
  async function waitForRequestedScan(handle: string, requestedAt: string): Promise<boolean> {
    const startupDeadline = Date.now() + 3 * 60 * 1000;
    let socialReceived = false;
    let sawLiveScan = false;
    while (true) {
      await new Promise((resolve) => window.setTimeout(resolve, 3500));

      const scan = await readScanProgress(handle);
      if (scan?.live) sawLiveScan = true;
      if (scan?.state === "error" || scan?.state === "interrupted" || (sawLiveScan && scan?.stalled)) {
        setStatus(
          language === "tr"
            ? `Tarama durdu: ${scan.text ?? "sebep bilinmiyor"}${scan.hint ? ` ${scan.hint}` : ""}`
            : `Scan stopped: ${scan.text ?? "unknown reason"}${scan.hint ? ` ${scan.hint}` : ""}`,
        );
        return false;
      }
      if (scan?.state === "cancelled") {
        setStatus(language === "tr" ? "Tarama iptal edildi." : "Scan cancelled.");
        return false;
      }
      if (!sawLiveScan && Date.now() > startupDeadline) {
        setStatus(
          language === "tr"
            ? "Eklenti taramayi baslatmadi. Letterboxd sekmesini yenile ve eklenti penceresinden baslat."
            : "The extension never started. Refresh the Letterboxd tab and start it from the extension popup.",
        );
        return false;
      }

      try {
        const response = await fetch(`/api/letterboxd/social?handle=${encodeURIComponent(handle)}&source=extension`);
        if (!response.ok) continue;
        const payload = (await response.json()) as SocialData;
        if (!payload.available || Date.parse(payload.checkedAt) < Date.parse(requestedAt)) continue;
        const enriched = addFollowerChanges(handle, payload, socialByHandleRef.current[handle]);
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
          return true;
        }
      } catch {
        // The extension may still be scanning.
      }
    }
  }

  async function readScanProgress(handle: string): Promise<ScanProgress | undefined> {
    try {
      const response = await fetch(`/api/extension/progress?handle=${encodeURIComponent(handle)}`);
      if (!response.ok) return undefined;
      const payload = await response.json();
      return payload.progress as ScanProgress | undefined;
    } catch {
      return undefined;
    }
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
    const handles: string[] = [];
    const members: SocialMember[] = [];
    let networkAvailable = true;
    try {
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
    } catch (error) {
      // Without a network scan the direct following/followers still get refreshed.
      console.warn(error);
      networkAvailable = false;
    }
    const social = socialByHandleRef.current[handle];
    const directMembers = social?.available ? [...social.following, ...social.followers] : [];
    const directHandles = [...new Set(directMembers.map((member) => member.username.toLowerCase()))];
    const directSet = new Set(directHandles);
    const discoveries = handles.filter(
      (candidate) => candidate !== handle.toLowerCase() && !directSet.has(candidate.toLowerCase()),
    );
    if (!directHandles.length && !discoveries.length) {
      setStatus(language === "tr" ? "Ag taramasi bulunamadi. Chrome eklentisinden ag haritasini calistir." : "Network scan not found. Run the network map in the Chrome extension.");
      setLoading(false);
      return;
    }
    await fetchProfilesForHandles([...directHandles, ...discoveries], [...directMembers, ...members]);
    if (!networkAvailable) {
      setStatus((current) => `${current} ${language === "tr" ? "Ag taramasi olmadigi icin yalniz takip/takipci listesi guncellendi." : "No network scan yet, so only following/followers were refreshed."}`);
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
        headers: { "Content-Type": "application/json", "X-TasteTwin-Request": "app" },
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
    const confirmed = window.confirm(
      language === "tr"
        ? "Takipci gecmisi (kim ne zaman takip etti/cikti) ve karsilastirma baslangici silinsin mi? Once yedek almak istersen Iptal'e bas."
        : "Delete the follower history (who followed or unfollowed and when) and the comparison baseline? Press Cancel to back up first.",
    );
    if (!confirmed) return;
    // A marker, not a removal: otherwise the last saved scan would be reused as the baseline.
    localStorage.setItem(`tastetwin.followers.${handle}`, JSON.stringify({ reset: true }));
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
          followerEvents: [],
          history: [],
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
    const confirmed = window.confirm(
      language === "tr"
        ? "Tum film arsivi, sosyal taramalar, takip gecmisi ve yonetim listeleri bu bilgisayardan silinecek. Once Veri yedegi ve tasima bolumunden yedek alman onerilir. Silinsin mi?"
        : "All film archives, social scans, follow history and management lists will be deleted from this computer. Back up your data first. Continue?",
    );
    if (!confirmed) return;
    const handle = (accountHandle || activeUser?.handle || "").toLowerCase();
    setUsers([]);
    setActiveId("");
    setAccountHandle("");
    setSocialByHandle({});
    setManagementQueuesByHandle({});
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
              if (event.key === "Enter") void openLetterboxdAndScan(false);
            }}
          />
          <button className="primary-button full-refresh-button" onClick={() => void runFullRefresh()} disabled={socialLoading || loading || fullRefresh?.running}>
            {fullRefresh?.running ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
            <span>{language === "tr" ? "Tum verileri tek tusla guncelle" : "Refresh all data in one click"}</span>
          </button>
          {fullRefresh && <FullRefreshPanel language={language} steps={fullRefresh.steps} running={fullRefresh.running} />}
          <button className="browser-scan-button" onClick={() => void openLetterboxdAndScan(false)} disabled={socialLoading || loading}>
            {socialLoading ? <Loader2 className="spin" size={18} /> : <Globe2 size={18} />}
            <span>{language === "tr" ? "Sadece takip/ag taramasi" : "Social and network scan only"}</span>
          </button>
          <ScanStatusPanel
            handle={(accountHandle || activeUser?.handle || "").trim().replace(/^@/, "").toLowerCase()}
            language={language}
            onResume={(resume) => void openLetterboxdAndScan(resume)}
          />
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
          <input type="file" accept=".zip,.csv,text/csv" disabled={!storageReady} onChange={(event) => handleUpload(event.target.files?.[0])} />
        </label>

        <button className="browser-scan-button" onClick={refreshOwnActivity} disabled={loading || !storageReady || !accountHandle}>
          <RefreshCcw size={16} /><span>{language === "tr" ? "Son film aktivitelerimi güncelle" : "Refresh my recent films"}</span>
        </button>
        <a href="https://letterboxd.com/settings/data/" target="_blank" rel="noreferrer">{language === "tr" ? "Letterboxd’dan güncel ZIP al" : "Get a fresh Letterboxd ZIP"}</a>

        <details className="backup-settings">
          <summary>
            <Download size={16} />
            {language === "tr" ? "Veri yedegi ve tasima" : "Backup and transfer"}
          </summary>
          <p>
            {language === "tr"
              ? "Film arsivini, sosyal taramalari, takip gecmisini ve yonetim listelerini tek JSON dosyasina kaydeder. TMDB tokeni yedege konmaz."
              : "Saves the film archive, social scans, follow history and management lists into one JSON file. The TMDB token is excluded."}
          </p>
          <button className="browser-scan-button" onClick={exportLocalBackup} disabled={!users.length}>
            <Download size={17} />
            <span>{language === "tr" ? "Tum yerel veriyi yedekle" : "Back up all local data"}</span>
          </button>
          <label className="browser-scan-button backup-import-button">
            <FileUp size={17} />
            <span>{language === "tr" ? "Yedegi geri yukle" : "Restore backup"}</span>
            <input type="file" accept=".json,application/json" disabled={!storageReady} onChange={(event) => importLocalBackup(event.target.files?.[0])} />
          </label>
          {cloudBackup && (
            <div className="cloud-backup">
              <strong>{language === "tr" ? "Kisisel bulut yedegi" : "Personal cloud backup"}</strong>
              <p>
                {language === "tr"
                  ? "Google Drive, OneDrive, iCloud veya Dropbox masaustu uygulamasinin senkron klasorunu sec. TasteTwin yedegi oraya yazar, senkron uygulaman buluta yukler; baska bilgisayarda ayni klasorden geri yuklersin. Hesap sifresi veya token istenmez."
                  : "Pick the sync folder of the Google Drive, OneDrive, iCloud or Dropbox desktop app. TasteTwin writes the backup there and your sync app uploads it; restore from the same folder on another computer. No account password or token is needed."}
              </p>
              {cloudBackup.candidates.length > 0 && (
                <div className="cloud-candidates">
                  {cloudBackup.candidates.map((candidate) => (
                    <button key={candidate.folder} className="cloud-chip" onClick={() => setCloudFolderInput(candidate.folder)} title={candidate.folder}>
                      {candidate.provider}
                    </button>
                  ))}
                </div>
              )}
              <div className="cloud-folder-row">
                <input
                  value={cloudFolderInput}
                  onChange={(event) => setCloudFolderInput(event.target.value)}
                  placeholder={language === "tr" ? "Klasorun tam yolu, or. G:\\My Drive" : "Full folder path, e.g. G:\\My Drive"}
                  aria-label={language === "tr" ? "Bulut yedek klasoru" : "Cloud backup folder"}
                />
                <button className="browser-scan-button" disabled={cloudBusy || !cloudFolderInput.trim()} onClick={() => saveCloudFolder(cloudFolderInput)}>
                  {language === "tr" ? "Kaydet" : "Save"}
                </button>
              </div>
              {cloudBackup.folder && (
                <>
                  <p className="muted-line">
                    {cloudBackup.backupDirectory}
                    {!cloudBackup.folderAvailable && (language === "tr" ? " (su an bulunamiyor)" : " (currently missing)")}
                    {" · "}
                    {cloudBackup.latest
                      ? `${language === "tr" ? "Son yedek" : "Last backup"}: ${new Date(cloudBackup.latest.savedAt).toLocaleString(language === "tr" ? "tr-TR" : "en-US")} (${(cloudBackup.latest.bytes / 1024 / 1024).toFixed(1)} MB)`
                      : language === "tr" ? "Henuz yedek yok" : "No backup yet"}
                  </p>
                  <label className="cloud-auto">
                    <input
                      type="checkbox"
                      checked={cloudAuto}
                      onChange={(event) => {
                        setCloudAuto(event.target.checked);
                        localStorage.setItem("tastetwin.cloudAuto", event.target.checked ? "on" : "off");
                      }}
                    />
                    {language === "tr" ? "Degisikliklerden 1 dakika sonra otomatik yedekle (son 14 gun saklanir)" : "Back up automatically a minute after changes (keeps 14 days)"}
                  </label>
                  {cloudAuto && cloudLinked !== cloudBackup.folder && (
                    <p className="muted-line">
                      {language === "tr"
                        ? "Otomatik yedek, bu bilgisayar klasorle bir kez eslesince (Simdi yedekle veya Buluttan geri yukle) baslar."
                        : "Automatic backups start once this computer has synced with the folder (Back up now or Restore from cloud)."}
                    </p>
                  )}
                  <div className="cloud-folder-row">
                    <button className="browser-scan-button" disabled={cloudBusy || !users.length} onClick={() => backupToCloud()}>
                      <Download size={16} />
                      <span>{language === "tr" ? "Simdi yedekle" : "Back up now"}</span>
                    </button>
                    <button className="browser-scan-button" disabled={cloudBusy || !cloudBackup.latest || !storageReady} onClick={restoreFromCloud}>
                      <FileUp size={16} />
                      <span>{language === "tr" ? "Buluttan geri yukle" : "Restore from cloud"}</span>
                    </button>
                    <button className="browser-scan-button" disabled={cloudBusy} onClick={() => saveCloudFolder("")}>
                      {language === "tr" ? "Kapat" : "Turn off"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </details>

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
              {[...new Map([...(activeUser ? [activeUser] : []), ...users.filter(user => `${user.handle} ${user.displayName}`.toLocaleLowerCase().includes(profileQuery.toLocaleLowerCase())).slice(0, 100)].map(user => [user.id, user])).values()].map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
            {users.length > 100 && <input aria-label={language === "tr" ? "Profil ara" : "Search profiles"} placeholder={language === "tr" ? `${users.length.toLocaleString("tr")} profilde ara…` : `Search ${users.length.toLocaleString("en")} profiles…`} value={profileQuery} onChange={event => setProfileQuery(event.target.value)} />}
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
        <small className="build-version">TasteTwin {appVersion} · extension {extensionVersion}</small>

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
              <FilmWorkspace
                language={language}
                user={activeUser}
                stats={stats}
                insights={filmInsights!}
                ranking={watchlistRanking}
                recommendations={recommendations}
                decadeData={decadeData}
                genreTerms={genreTerms}
                directorTerms={directorTerms}
                tmdbLoading={tmdbLoading}
                tmdbRun={tmdbRun}
                onEnrich={enrichWithTmdb}
                users={users}
                hasTmdbToken={Boolean(tmdbToken.trim())}
              />
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
              <>
              <FullRatingsPanel
                language={language}
                users={users}
                scan={ratingsScan}
                hasSocial={Boolean(socialByHandle[accountHandle || activeUser.handle]?.available)}
                onStart={(scope, count, pages) => void requestRatingsScan(ratingsTargetsFor(scope, count), pages)}
                previewCount={(scope, count) => ratingsTargetsFor(scope, count).length}
              />
              <FilmPeopleFinder
                language={language}
                users={users}
                ownerHandle={accountHandle || activeUser.handle}
                social={socialByHandle[accountHandle || activeUser.handle]}
                matches={matches}
                onSelectMatch={setSelectedMatch}
              />
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
                managementQueues={managementQueuesByHandle[accountHandle || activeUser.handle] ?? { follow: [], unfollow: [] }}
                onManagementQueuesChange={(queues) =>
                  setManagementQueuesByHandle((current) => ({
                    ...current,
                    [accountHandle || activeUser.handle]: queues,
                  }))
                }
              />
              </>
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
      {selectedMatch && activeUser && (
        <MatchDetail
          key={selectedMatch.user.id}
          target={activeUser}
          language={language}
          match={selectedMatch}
          avatarUrl={selectedMatch.user.avatarUrl || avatarByHandle.get(selectedMatch.user.handle.toLowerCase())}
          onClose={() => setSelectedMatch(undefined)}
        />
      )}
    </div>
  );
}

type FilmWorkspaceView = "summary" | "stats" | "rhythm" | "recommendations";

function FilmWorkspace({
  language,
  user,
  stats,
  insights,
  ranking,
  recommendations,
  decadeData,
  genreTerms,
  directorTerms,
  tmdbLoading,
  tmdbRun,
  onEnrich,
  hasTmdbToken,
  users,
}: {
  language: Language;
  user: UserTaste;
  stats: ReturnType<typeof getStats>;
  insights: ReturnType<typeof buildFilmInsights>;
  ranking: ReturnType<typeof buildWatchlistRanking>;
  recommendations: ReturnType<typeof buildRecommendations>;
  decadeData: Array<[string, number]>;
  genreTerms: Array<[string, number]>;
  directorTerms: Array<[string, number]>;
  tmdbLoading: boolean;
  tmdbRun: TmdbRunState;
  onEnrich: () => void;
  hasTmdbToken: boolean;
  users: UserTaste[];
}) {
  const [view, setView] = useState<FilmWorkspaceView>("summary");
  const enrichable = user.films.filter(
    (film) => film.watchlist || film.rating !== undefined || film.watchedDates.length > 0 || film.liked,
  );
  const enriched = enrichable.filter((film) => film.tmdbId).length;
  const views: Array<[FilmWorkspaceView, string, typeof Film]> = [
    ["summary", language === "tr" ? "Genel bakis" : "Overview", Film],
    ["stats", language === "tr" ? "Istatistikler" : "Statistics", BarChart3],
    ["rhythm", language === "tr" ? "Izleme gecmisi" : "Viewing history", Clock3],
    ["recommendations", language === "tr" ? "Ne izlesem?" : "What to watch", Sparkles],
  ];

  return (
    <section className="film-workspace">
      <nav className="film-workspace-tabs" aria-label={language === "tr" ? "Film paneli bolumleri" : "Film dashboard sections"}>
        {views.map(([id, label, Icon]) => (
          <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className={`film-data-health ${enriched < enrichable.length ? "incomplete" : "complete"}`}>
        <div>
          <strong>{language === "tr" ? "Veri kapsami" : "Data coverage"}</strong>
          <span>
            {language === "tr"
              ? `${stats.watched} izlenmis film · ${insights.diaryEntries} tarihli diary kaydi · ${enriched}/${enrichable.length} film TMDB verili · ${insights.runtimeFilms} filmde sure`
              : `${stats.watched} watched · ${insights.diaryEntries} dated diary entries · ${enriched}/${enrichable.length} with TMDB data · ${insights.runtimeFilms} with runtime`}
          </span>
          {tmdbRun.lastRun && (
            <small>
              {language === "tr" ? "Son TMDB islemi" : "Last TMDB run"}:{" "}
              {new Date(tmdbRun.lastRun).toLocaleString(language === "tr" ? "tr-TR" : "en-US")}
            </small>
          )}
        </div>
        {enriched < enrichable.length && (
          <button className="primary-button" onClick={onEnrich} disabled={!hasTmdbToken || tmdbLoading}>
            {tmdbLoading ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
            <span>
              {!hasTmdbToken
                ? language === "tr"
                  ? "Once soldan TMDB tokeni gir"
                  : "Add a TMDB token in the sidebar"
                : language === "tr"
                  ? `Eksik ${enrichable.length - enriched} filmi tamamla`
                  : `Complete ${enrichable.length - enriched} films`}
            </span>
          </button>
        )}
      </div>

      {view === "summary" && (
        <div className="film-view film-summary-view">
          <StatsPanel language={language} stats={stats} />
          <div className="film-summary-grid">
            <NextWatchPanel language={language} ranking={ranking} />
            <PosterPanel language={language} films={user.films} />
          </div>
          <div className="film-summary-shortcuts">
            <button onClick={() => setView("stats")}>
              <BarChart3 size={20} />
              <strong>
                {insights.totalRuntimeMinutes.toLocaleString(language === "tr" ? "tr-TR" : "en-US")}{" "}
                {language === "tr" ? "dk" : "min"}
              </strong>
              <span>
                {language === "tr"
                  ? `${formatRuntime(insights.totalRuntimeMinutes, language)} toplam izleme`
                  : `${formatRuntime(insights.totalRuntimeMinutes, language)} total watch time`}
              </span>
            </button>
            <button onClick={() => setView("stats")}>
              <Users size={20} />
              <strong>{insights.topCast[0]?.name ?? "-"}</strong>
              <span>{language === "tr" ? "en cok izlenen oyuncu" : "most watched actor"}</span>
            </button>
            <button onClick={() => setView("rhythm")}>
              <Clock3 size={20} />
              <strong>{insights.monthlyActivity.at(-1)?.count ?? 0}</strong>
              <span>{language === "tr" ? "son kayitli ay" : "latest recorded month"}</span>
            </button>
            <button onClick={() => setView("recommendations")}>
              <Heart size={20} />
              <strong>{ranking.length}</strong>
              <span>{language === "tr" ? "izlenmemis watchlist adayi" : "unwatched watchlist picks"}</span>
            </button>
          </div>
        </div>
      )}

      {view === "stats" && (
        <div className="film-view film-panel-grid">
          <FilmInsightsPanel language={language} insights={insights} />
          <BarsPanel title={t(language, "tasteDna")} icon={<Heart size={18} />} data={genreTerms} />
          <SignalPanel language={language} user={user} directors={directorTerms} />
        </div>
      )}

      {view === "rhythm" && (
        <div className="film-view film-panel-grid">
          <ViewingRhythmPanel language={language} insights={insights} />
          <BarsPanel title={t(language, "favoriteZones")} icon={<Film size={18} />} data={decadeData} />
          <PosterPanel language={language} films={user.films} />
          <FilmArchiveBrowser language={language} owner={user} users={users} />
        </div>
      )}

      {view === "recommendations" && (
        <div className="film-view film-recommendations-grid">
          <NextWatchPanel language={language} ranking={ranking} />
          <RecommendationPanel language={language} recommendations={recommendations} />
        </div>
      )}
    </section>
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
    [
      language === "tr" ? "Toplam dakika" : "Total minutes",
      `${insights.totalRuntimeMinutes.toLocaleString(language === "tr" ? "tr-TR" : "en-US")} ${language === "tr" ? "dk" : "min"}`,
    ],
    [
      language === "tr" ? "Ortalama film suresi" : "Average runtime",
      insights.averageRuntimeMinutes ? `${insights.averageRuntimeMinutes} ${language === "tr" ? "dk" : "min"}` : "-",
    ],
    [language === "tr" ? "Ortalama puan" : "Average rating", insights.averageRating ? insights.averageRating.toFixed(2) : "-"],
    [language === "tr" ? "Tekrar izleme" : "Rewatch views", `${insights.rewatchViews} (%${insights.rewatchRate})`],
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
            ? `${formatRuntime(insights.totalRuntimeMinutes, language)}. Sure hesabi ${insights.runtimeCoverage}% kapsama dayanir. Tekrar izlemeler dahil edilir; watchlist izlenmis sayilmaz.`
            : `${formatRuntime(insights.totalRuntimeMinutes, language)}. Watch time uses ${insights.runtimeCoverage}% runtime coverage. Rewatches count; watchlist-only films do not.`}
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
    </>
  );
}

function ViewingRhythmPanel({
  language,
  insights,
}: {
  language: Language;
  insights: ReturnType<typeof buildFilmInsights>;
}) {
  return (
    <div className="panel viewing-rhythm">
      <div className="panel-title">
        <Clock3 size={18} />
        <h2>{language === "tr" ? "Izleme yogunlugu" : "Viewing rhythm"}</h2>
      </div>
      <MiniBars
        data={insights.monthlyActivity}
        empty={language === "tr" ? "Diary tarih verisi yok" : "No diary dates"}
      />
      <div className="rhythm-highlights">
        <div>
          <strong>{insights.longestStreakDays}</strong>
          <span>{language === "tr" ? "en uzun gun serisi" : "longest daily streak"}</span>
        </div>
        <div>
          <strong>{insights.latestStreakDays}</strong>
          <span>{language === "tr" ? "son kayit serisi" : "latest diary streak"}</span>
        </div>
        <div>
          <strong>{insights.uniqueDiaryDays}</strong>
          <span>{language === "tr" ? "farkli izleme gunu" : "distinct viewing days"}</span>
        </div>
        <div>
          <strong>
            {insights.busiestMonth
              ? `${insights.busiestMonth.name} · ${insights.busiestMonth.count}`
              : "-"}
          </strong>
          <span>{language === "tr" ? "en yogun ay" : "busiest month"}</span>
        </div>
      </div>
      {insights.firstDiaryDate && insights.lastDiaryDate && (
        <p className="diary-span">
          {language === "tr" ? "Diary araligi" : "Diary span"}:{" "}
          <strong>
            {new Date(`${insights.firstDiaryDate}T00:00:00`).toLocaleDateString(language === "tr" ? "tr-TR" : "en-US")}
            {" - "}
            {new Date(`${insights.lastDiaryDate}T00:00:00`).toLocaleDateString(language === "tr" ? "tr-TR" : "en-US")}
          </strong>
        </p>
      )}
      <h3>{language === "tr" ? "Aylara gore film dagilimi" : "Films by month"}</h3>
      <MiniBars
        data={insights.monthOfYearActivity}
        compactLabels
        empty={language === "tr" ? "Diary tarih verisi yok" : "No diary dates"}
      />
      {insights.yearlyActivity.length > 0 && (
        <>
          <h3>{language === "tr" ? "Yillara gore" : "By year"}</h3>
          <MiniBars data={insights.yearlyActivity} compactLabels empty="" />
        </>
      )}
      <div className="weekday-row">
        {insights.weekdayActivity.map((item) => (
          <div key={item.name}>
            <strong>{item.count}</strong>
            <span>{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniBars({
  data,
  empty,
  compactLabels = false,
}: {
  data: Array<{ name: string; count: number }>;
  empty: string;
  compactLabels?: boolean;
}) {
  if (!data.length) return <p className="muted-line">{empty}</p>;
  const max = Math.max(...data.map((item) => item.count), 1);
  return (
    <div className="mini-bars">
      {data.map((item) => (
        <div key={item.name} title={`${item.name}: ${item.count}`}>
          <span style={{ height: `${Math.max(5, (item.count / max) * 100)}%` }} />
          <small>{compactLabels ? item.name : item.name.slice(5)}</small>
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
  managementQueues,
  onManagementQueuesChange,
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
  managementQueues: SocialManagementQueues;
  onManagementQueuesChange: (queues: SocialManagementQueues) => void;
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
          <p className="live-bridge-note">
            <span />
            {language === "tr"
              ? `Canli baglanti acik. TasteTwin ile yaptigin son tiklamalar 2 saniye icinde yansir${data.liveUpdatedAt ? ` · son guncelleme ${new Date(data.liveUpdatedAt).toLocaleTimeString("tr-TR")}` : ""}.`
              : `Live bridge on. Final clicks made through TasteTwin appear within 2 seconds${data.liveUpdatedAt ? ` · last update ${new Date(data.liveUpdatedAt).toLocaleTimeString("en-US")}` : ""}.`}
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
      <FollowerTimeline language={language} handle={data.handle} events={data.followerEvents ?? []} />
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
        managementQueues={managementQueues}
        onManagementQueuesChange={onManagementQueuesChange}
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
  managementQueues,
  onManagementQueuesChange,
}: {
  language: Language;
  data: AvailableSocialData;
  users: UserTaste[];
  matches: MatchResult[];
  loading: boolean;
  onLoadActivity: (handles: string[], members: SocialMember[]) => void;
  activityScanProgress?: ActivityScanProgress;
  onSelectMatch: (match: MatchResult) => void;
  managementQueues: SocialManagementQueues;
  onManagementQueuesChange: (queues: SocialManagementQueues) => void;
}) {
  const [query, setQuery] = useState("");
  const [myFollow, setMyFollow] = useState<RelationshipFilter>("any");
  const [followsMe, setFollowsMe] = useState<RelationshipFilter>("any");
  const [source, setSource] = useState<"all" | "direct" | "network">("all");
  const [activity, setActivity] = useState<"any" | "known" | "unknown">("any");
  const [activityAge, setActivityAge] = useState<SocialDirectoryFilters["activityAge"]>("any");
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
  const [manageAction, setManageAction] = useState<"unfollow" | "follow">("unfollow");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selectedHandles, setSelectedHandles] = useState<Set<string>>(() => new Set());
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
      activityAge,
      category,
      minTaste,
      maxTaste,
      minActivity: minDirectoryActivity,
      maxActivity: maxDirectoryActivity,
      minConnections: minDirectoryConnections,
      maxConnections: maxDirectoryConnections,
      sort,
    }),
    [activity, activityAge, category, directory, followsMe, maxDirectoryActivity, maxDirectoryConnections, maxTaste, minDirectoryActivity, minDirectoryConnections, minTaste, myFollow, query, sort, source],
  );
  const pagination = useMemo(
    () => paginateSocialDirectory(filtered, page, pageSize),
    [filtered, page, pageSize],
  );
  const eligibleFiltered = useMemo(
    () => filtered.filter((entry) => manageAction === "unfollow" ? entry.myFollow : !entry.myFollow),
    [filtered, manageAction],
  );
  const queuedEntries = useMemo(() => {
    const handles = new Set(managementQueues[manageAction]);
    return directory.filter((entry) => handles.has(entry.username.toLowerCase()));
  }, [directory, managementQueues, manageAction]);

  useEffect(() => {
    setPage(1);
  }, [activity, activityAge, category, followsMe, maxDirectoryActivity, maxDirectoryConnections, maxTaste, minDirectoryActivity, minDirectoryConnections, minTaste, myFollow, pageSize, query, sort, source]);

  useEffect(() => {
    setSelectedHandles(new Set());
  }, [data.handle]);

  useEffect(() => {
    const byHandle = new Map(directory.map((entry) => [entry.username.toLowerCase(), entry]));
    const follow = managementQueues.follow.filter((handle) => !byHandle.get(handle)?.myFollow);
    const unfollow = managementQueues.unfollow.filter((handle) => byHandle.get(handle)?.myFollow);
    if (
      follow.length !== managementQueues.follow.length ||
      unfollow.length !== managementQueues.unfollow.length
    ) {
      onManagementQueuesChange({ follow, unfollow });
    }
  }, [directory, managementQueues, onManagementQueuesChange]);

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
          label={language === "tr" ? "Son aktiflik" : "Last activity"}
          value={activityAge}
          onChange={(value) => setActivityAge(value as SocialDirectoryFilters["activityAge"])}
          options={[
            ["any", language === "tr" ? "Fark etmez" : "Any"],
            ["active30", language === "tr" ? "Son 30 gunde aktif" : "Active in 30 days"],
            ["active90", language === "tr" ? "Son 90 gunde aktif" : "Active in 90 days"],
            ["inactive90", language === "tr" ? "90+ gun pasif" : "Inactive 90+ days"],
            ["inactive180", language === "tr" ? "180+ gun pasif" : "Inactive 180+ days"],
            ["inactive365", language === "tr" ? "365+ gun pasif" : "Inactive 365+ days"],
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
        <DirectorySelect
          label={language === "tr" ? "Filtrelenmis liste islemi" : "Filtered list action"}
          value={manageAction}
          onChange={(value) => setManageAction(value as typeof manageAction)}
          options={[
            ["unfollow", language === "tr" ? "Takipten cikacaklar" : "Unfollow review"],
            ["follow", language === "tr" ? "Takip edilecekler" : "Follow review"],
          ]}
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
          disabled={!filtered.length}
          onClick={() => {
            const url = URL.createObjectURL(new Blob([socialDirectoryCsv(filtered, language)], { type: "text/csv;charset=utf-8" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = `tastetwin-social-${data.handle}-${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={16} />
          {language === "tr" ? `Filtrelenenleri CSV indir (${filtered.length})` : `Export filtered CSV (${filtered.length})`}
        </button>
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
      <div className="directory-manage-bar">
        <div>
          <strong>
            {manageAction === "unfollow"
              ? language === "tr"
                ? "Takipten cikma incelemesi"
                : "Unfollow review"
              : language === "tr"
                ? "Takip etme incelemesi"
                : "Follow review"}
          </strong>
          <span>
            {language === "tr"
              ? "Yukaridaki normal arama ve filtreler aynen bu listeye uygulanir."
              : "The search and filters above are applied to this review list."}
          </span>
        </div>
        <div className="selection-actions">
          <button
            className="browser-scan-button"
            disabled={!eligibleFiltered.length}
            onClick={() => setSelectedHandles(new Set(eligibleFiltered.map((entry) => entry.username.toLowerCase())))}
          >
            <UserCheck size={16} />
            {language === "tr"
              ? `Bu kriterlerdeki herkesi sec (${eligibleFiltered.length})`
              : `Select everyone matching (${eligibleFiltered.length})`}
          </button>
          <button
            className="browser-scan-button"
            disabled={!selectedHandles.size}
            onClick={() => setSelectedHandles(new Set())}
          >
            <X size={16} />
            {language === "tr" ? "Secimi temizle" : "Clear selection"}
          </button>
          <button
            className="primary-button"
            disabled={!selectedHandles.size}
            onClick={() => {
              onManagementQueuesChange({
                ...managementQueues,
                [manageAction]: [...new Set([...managementQueues[manageAction], ...selectedHandles])],
              });
              setReviewOpen(true);
            }}
          >
            {manageAction === "unfollow" ? <UserMinus size={16} /> : <UserCheck size={16} />}
            {language === "tr"
              ? `Secilen ${selectedHandles.size} kisiyi listeye ekle`
              : `Add ${selectedHandles.size} selected`}
          </button>
        </div>
      </div>
      <div className="queue-tabs">
        <button
          className={manageAction === "unfollow" ? "active" : ""}
          onClick={() => {
            setManageAction("unfollow");
            setReviewOpen(true);
          }}
        >
          <UserMinus size={16} />
          {language === "tr" ? "Takipten cikilacaklar" : "Unfollow list"} <strong>{managementQueues.unfollow.length}</strong>
        </button>
        <button
          className={manageAction === "follow" ? "active" : ""}
          onClick={() => {
            setManageAction("follow");
            setReviewOpen(true);
          }}
        >
          <UserCheck size={16} />
          {language === "tr" ? "Takip edilecekler" : "Follow list"} <strong>{managementQueues.follow.length}</strong>
        </button>
      </div>
      {reviewOpen && (
        <SocialReviewQueue
          language={language}
          entries={queuedEntries}
          action={manageAction}
          onRemove={(handle) =>
            onManagementQueuesChange({
              ...managementQueues,
              [manageAction]: managementQueues[manageAction].filter((item) => item !== handle.toLowerCase()),
            })
          }
          onClear={() => onManagementQueuesChange({ ...managementQueues, [manageAction]: [] })}
        />
      )}
      <SocialDirectoryList
        entries={pagination.items}
        language={language}
        onSelectMatch={onSelectMatch}
        selectedHandles={selectedHandles}
        onToggleSelection={(handle) =>
          setSelectedHandles((current) => {
            const next = new Set(current);
            if (next.has(handle)) next.delete(handle);
            else next.add(handle);
            return next;
          })
        }
      />
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

function SocialReviewQueue({
  language,
  entries,
  action,
  onRemove,
  onClear,
}: {
  language: Language;
  entries: SocialDirectoryEntry[];
  action: "follow" | "unfollow";
  onRemove: (handle: string) => void;
  onClear: () => void;
}) {
  const [queuePage, setQueuePage] = useState(1);
  const pageSize = 120;
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const pending = entries.slice((queuePage - 1) * pageSize, queuePage * pageSize);

  useEffect(() => {
    setQueuePage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  async function openForReview(entry: SocialDirectoryEntry) {
    try {
      await fetch("/api/extension/request-manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-TasteTwin-Request": "app" },
        body: JSON.stringify({ handle: entry.username, action }),
      });
    } catch {
      // The profile still opens even if the extension guidance is unavailable.
    }
    window.open(`https://letterboxd.com/${encodeURIComponent(entry.username)}/`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="social-review-queue" data-testid="social-review-queue">
      <div className="queue-header">
        <div>
          <strong>
            {language === "tr"
              ? `${entries.length} kisi listede · sayfa ${queuePage}/${totalPages}`
              : `${entries.length} people queued · page ${queuePage}/${totalPages}`}
          </strong>
          <span>
            {language === "tr"
              ? "Yonet dugmesi profili acar; guncel eklenti Letterboxd takip dugmesini bulup vurgular. Son tiklama sende kalir."
              : "Manage opens the profile; the current extension highlights Letterboxd's follow control. The final click stays with you."}
          </span>
        </div>
        <div className="queue-header-actions">
          <button className="browser-scan-button" disabled={!entries.length} onClick={onClear}>
            <X size={16} />
            {language === "tr" ? "Listeyi temizle" : "Clear list"}
          </button>
          <button className="primary-button" disabled={!pending.length} onClick={() => pending[0] && openForReview(pending[0])}>
            <ExternalLink size={16} />
            {language === "tr" ? "Siradaki profili ac" : "Open next profile"}
          </button>
        </div>
      </div>
      <ul className="action-queue dense-action-queue">
        {pending.map((entry) => (
          <li key={entry.username}>
            <Avatar name={entry.displayName} src={entry.avatarUrl} />
            <div>
              <strong>{entry.displayName}</strong>
              <span>
                @{entry.username}
                {entry.match ? ` · zevk ${entry.match.score}` : ""}
                {entry.activity?.activityScore !== undefined ? ` · aktiflik ${entry.activity.activityScore}` : ""}
                {entry.activity?.lastActivityAt ? ` · ${formatActivity(entry.activity, language)}` : ""}
              </span>
            </div>
            <button
              className="queue-skip"
              onClick={() => onRemove(entry.username)}
              title={language === "tr" ? "Listeden cikar" : "Remove from list"}
            >
              <X size={16} />
            </button>
            <button className="queue-manage" onClick={() => openForReview(entry)}>
              <ExternalLink size={16} />
              <span>{language === "tr" ? "Yonet" : "Manage"}</span>
            </button>
          </li>
        ))}
      </ul>
      {entries.length > pageSize && (
        <nav className="match-pagination directory-pagination">
          <button disabled={queuePage <= 1} onClick={() => setQueuePage((value) => Math.max(1, value - 1))}>
            <ArrowLeft size={16} /> {language === "tr" ? "Onceki" : "Previous"}
          </button>
          <span>{queuePage}/{totalPages}</span>
          <button disabled={queuePage >= totalPages} onClick={() => setQueuePage((value) => Math.min(totalPages, value + 1))}>
            {language === "tr" ? "Sonraki" : "Next"} <ArrowRight size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}

function SocialDirectoryList({
  entries,
  language,
  onSelectMatch,
  selectedHandles,
  onToggleSelection,
}: {
  entries: SocialDirectoryEntry[];
  language: Language;
  onSelectMatch: (match: MatchResult) => void;
  selectedHandles: Set<string>;
  onToggleSelection: (handle: string) => void;
}) {
  if (!entries.length) return <p className="empty-state">0</p>;
  return (
    <ul className="social-directory-list">
      {entries.map((entry) => (
        <li key={entry.username}>
          <input
            className="directory-select-checkbox"
            type="checkbox"
            checked={selectedHandles.has(entry.username.toLowerCase())}
            onChange={() => onToggleSelection(entry.username.toLowerCase())}
            aria-label={language === "tr" ? `${entry.displayName} sec` : `Select ${entry.displayName}`}
          />
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
  const recent = [...films]
    .filter(isWatched)
    .sort((a, b) => filmLatestTimestamp(b) - filmLatestTimestamp(a))
    .slice(0, 8);
  return (
    <div className="panel poster-panel">
      <div className="panel-title">
        <Clapperboard size={18} />
        <h2>{language === "tr" ? "Son izlenenler" : "Recently watched"}</h2>
      </div>
      <div className="poster-grid recent-poster-grid">
        {recent.map((film, index) => (
          <figure key={film.key}>
            <PosterTile film={film} index={index} />
            <figcaption>
              <strong>{film.title}</strong>
              <span>
                {formatFilmDate(film, language)}
                {film.rating !== undefined ? ` · ${formatRating(film.rating)}` : ""}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function FilmArchiveBrowser({ language, owner, users }: { language: Language; owner: UserTaste; users: UserTaste[] }) {
  const films = owner.films;
  const tr = language === "tr";
  const locale = tr ? "tr-TR" : "en-US";
  const [filters, setFilters] = useState<ArchiveFilters>(defaultArchiveFilters);
  const [showMore, setShowMore] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const networkRatings = useMemo(() => buildNetworkRatings(owner, users), [owner, users]);
  const facets = useMemo(() => ({
    genres: archiveFacet(films, "genres"),
    directors: archiveFacet(films, "directors"),
    countries: archiveFacet(films, "countries"),
    languages: archiveFacet(films, "originalLanguage"),
    years: watchedYears(films),
  }), [films]);
  const filtered = useMemo(() => filterArchive(films, filters, networkRatings, locale), [films, filters, networkRatings, locale]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const items = filtered.slice((page - 1) * pageSize, page * pageSize);
  const activeCount = Object.entries(filters).filter(([key, value]) => key !== "sort" && value !== defaultArchiveFilters[key as keyof ArchiveFilters]).length;
  const set = <K extends keyof ArchiveFilters>(key: K, value: ArchiveFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const optionalNumber = (value: string) => (value.trim() ? Number(value) : undefined);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  function downloadCsv() {
    const url = URL.createObjectURL(new Blob([archiveCsv(filtered, networkRatings, language)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `tastetwin-film-arsivi-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const facetSelect = (key: "genre" | "director" | "country" | "language", label: string, values: Array<[string, number]>) => (
    <label className="archive-field">
      <span>{label}</span>
      <select value={filters[key]} onChange={(event) => set(key, event.target.value)} disabled={!values.length}>
        <option value="">{values.length ? (tr ? "Tumu" : "All") : (tr ? "TMDB verisi yok" : "No TMDB data")}</option>
        {values.map(([value, count]) => <option key={value} value={value}>{value} ({count})</option>)}
      </select>
    </label>
  );

  return (
    <div className="panel film-archive-browser" data-testid="film-archive-browser">
      <div className="panel-title archive-browser-title">
        <Film size={18} />
        <div>
          <h2>{tr ? "Tum film arsivi" : "Complete film archive"}</h2>
          <p>{tr ? `${filtered.length}/${films.length} film gosteriliyor` : `Showing ${filtered.length}/${films.length} films`}</p>
        </div>
      </div>
      <div className="archive-browser-controls">
        <label className="member-search">
          <Search size={16} />
          <input
            value={filters.query}
            placeholder={tr ? "Film, yil, yonetmen veya oyuncu ara" : "Search film, year, director or cast"}
            onChange={(event) => set("query", event.target.value)}
          />
        </label>
        <select value={filters.status} onChange={(event) => set("status", event.target.value as ArchiveStatus)} aria-label={tr ? "Durum" : "Status"}>
          <option value="all">{tr ? "Tum kayitlar" : "All entries"}</option>
          <option value="watched">{tr ? "Izlenenler" : "Watched"}</option>
          <option value="rated">{tr ? "Puanlananlar" : "Rated"}</option>
          <option value="loved">{tr ? "Sevilenler" : "Loved"}</option>
          <option value="watchlist">{tr ? "Izlenmemis watchlist" : "Unwatched watchlist"}</option>
          <option value="unrated-watched">{tr ? "Izlenip puanlanmayanlar" : "Watched but unrated"}</option>
          <option value="rewatched">{tr ? "Tekrar izlenenler" : "Rewatched"}</option>
          <option value="reviewed">{tr ? "Yorum yazdiklarim" : "Reviewed"}</option>
        </select>
        <select value={filters.sort} onChange={(event) => set("sort", event.target.value as ArchiveSort)} aria-label={tr ? "Siralama" : "Sort"}>
          <option value="recent">{tr ? "En son izlenen" : "Most recent"}</option>
          <option value="rating">{tr ? "Puani en yuksek" : "Highest rating"}</option>
          <option value="network">{tr ? "Agin en sevdigi" : "Network favourite"}</option>
          <option value="network-gap">{tr ? "Agdan en farkli puanim" : "Most different from network"}</option>
          <option value="tmdb">{tr ? "TMDB puani" : "TMDB rating"}</option>
          <option value="year">{tr ? "En yeni yapim" : "Newest release"}</option>
          <option value="title">{tr ? "Film adi" : "Title"}</option>
          <option value="runtime">{tr ? "En uzun" : "Longest runtime"}</option>
        </select>
        <button className="browser-scan-button" onClick={() => setShowMore((value) => !value)} aria-expanded={showMore}>
          <Search size={15} />
          <span>{tr ? "Detayli filtre" : "More filters"}{activeCount ? ` (${activeCount})` : ""}</span>
        </button>
        <button className="browser-scan-button" onClick={downloadCsv} disabled={!filtered.length}>
          <Download size={15} />
          <span>CSV</span>
        </button>
      </div>
      {showMore && (
        <div className="archive-advanced">
          {facetSelect("genre", tr ? "Tur" : "Genre", facets.genres)}
          {facetSelect("director", tr ? "Yonetmen" : "Director", facets.directors)}
          {facetSelect("country", tr ? "Ulke" : "Country", facets.countries)}
          {facetSelect("language", tr ? "Dil" : "Language", facets.languages)}
          <label className="archive-field">
            <span>{tr ? "Puanim" : "My rating"}</span>
            <div className="archive-range">
              <input type="number" min={0} max={5} step={0.5} value={filters.minRating} onChange={(event) => set("minRating", Number(event.target.value) || 0)} aria-label={tr ? "En dusuk puan" : "Minimum rating"} />
              <span>–</span>
              <input type="number" min={0} max={5} step={0.5} value={filters.maxRating} onChange={(event) => set("maxRating", Number(event.target.value) || 5)} aria-label={tr ? "En yuksek puan" : "Maximum rating"} />
            </div>
          </label>
          <label className="archive-field">
            <span>{tr ? "Yapim yili" : "Release year"}</span>
            <div className="archive-range">
              <input type="number" placeholder="1900" value={filters.yearFrom ?? ""} onChange={(event) => set("yearFrom", optionalNumber(event.target.value))} aria-label={tr ? "Baslangic yili" : "From year"} />
              <span>–</span>
              <input type="number" placeholder="2026" value={filters.yearTo ?? ""} onChange={(event) => set("yearTo", optionalNumber(event.target.value))} aria-label={tr ? "Bitis yili" : "To year"} />
            </div>
          </label>
          <label className="archive-field">
            <span>{tr ? "Izledigim yil" : "Year watched"}</span>
            <select value={filters.watchedYear ?? ""} onChange={(event) => set("watchedYear", optionalNumber(event.target.value))}>
              <option value="">{tr ? "Tumu" : "All"}</option>
              {facets.years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="archive-field">
            <span>{tr ? "En fazla sure (dk)" : "Max runtime (min)"}</span>
            <input type="number" min={0} step={10} value={filters.maxRuntime ?? ""} onChange={(event) => set("maxRuntime", optionalNumber(event.target.value))} />
          </label>
          <label className="archive-field">
            <span>{tr ? "En az ag puani" : "Min network ratings"}</span>
            <input type="number" min={0} value={filters.minNetworkRatings} onChange={(event) => set("minNetworkRatings", Math.max(0, Number(event.target.value) || 0))} />
          </label>
          <button className="browser-scan-button" onClick={() => setFilters({ ...defaultArchiveFilters, sort: filters.sort })} disabled={!activeCount}>
            <X size={15} />
            <span>{tr ? "Filtreleri temizle" : "Clear filters"}</span>
          </button>
          <p className="muted-line archive-note">
            {tr
              ? "Ag ortalamasi, TasteTwin'e yuklenen diger uyelerin (takip, takipci, ag adaylari) puanlarindan hesaplanir; RSS yalniz son aktiviteyi kapsar. Tur, yonetmen, ulke ve dil icin TMDB zenginlestirmesi gerekir."
              : "Network mean uses ratings from other members loaded into TasteTwin (following, followers, network candidates); RSS covers recent activity only. Genre, director, country and language need TMDB enrichment."}
          </p>
        </div>
      )}
      <div className="archive-table">
        {items.map((film, index) => {
          const network = networkRatings.get(film.key);
          return (
            <div className="archive-row" key={film.key}>
              <PosterTile film={film} index={index} compact />
              <div>
                <strong>{film.title}</strong>
                <span>{[film.year, film.directors[0]].filter(Boolean).join(" · ") || "-"}</span>
              </div>
              <span>{film.rating !== undefined ? formatRating(film.rating) : "—"}</span>
              <span
                className="archive-network"
                title={network ? network.raters.slice(0, 12).map((rater) => `@${rater.handle}: ${formatRating(rater.rating)}`).join("\n") : undefined}
              >
                {network ? `${tr ? "Ag" : "Net"} ${network.mean.toFixed(1)} (${network.count})` : "—"}
              </span>
              <span>{film.runtimeMinutes ? `${film.runtimeMinutes} ${tr ? "dk" : "min"}` : "—"}</span>
              <span>{formatFilmDate(film, language)}</span>
              <span className="archive-state">
                {film.watchlist && !isWatched(film)
                  ? "Watchlist"
                  : film.liked || (film.rating ?? 0) >= 4
                    ? tr ? "Sevilen" : "Loved"
                    : isWatched(film)
                      ? tr ? "Izlendi" : "Watched"
                      : "—"}
              </span>
            </div>
          );
        })}
      </div>
      {filtered.length > pageSize && (
        <nav className="match-pagination archive-pagination">
          <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            <ArrowLeft size={16} /> {tr ? "Onceki" : "Previous"}
          </button>
          <span>
            {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, filtered.length)} / {filtered.length} · {page}/{totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
            {tr ? "Sonraki" : "Next"} <ArrowRight size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}

function filmLatestTimestamp(film: FilmSignal) {
  const values = [...film.watchedDates, film.activityDate].filter((value): value is string => Boolean(value));
  return values.reduce((latest, value) => Math.max(latest, Date.parse(value) || 0), 0);
}

function formatFilmDate(film: FilmSignal, language: Language) {
  const timestamp = filmLatestTimestamp(film);
  return timestamp
    ? new Date(timestamp).toLocaleDateString(language === "tr" ? "tr-TR" : "en-US")
    : language === "tr" ? "Tarih yok" : "No date";
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
  target,
  language,
  match,
  avatarUrl,
  onClose,
}: {
  target: UserTaste;
  language: Language;
  match: MatchResult;
  avatarUrl?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
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
        <ScoreBreakdown match={match} language={language} />

        <WatchTogetherPanel target={target} match={match} language={language} />

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
    lines.push(`${match.togetherPick.film.title}: ${togetherPickReason(match.togetherPick, language)}`);
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

function applyRelationshipEvent(
  data: AvailableSocialData,
  rawHandle: unknown,
  action: unknown,
): AvailableSocialData {
  const handle = String(rawHandle ?? "").toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(handle) || (action !== "follow" && action !== "unfollow")) return data;
  const known = [...data.following, ...data.followers, ...(data.networkCandidates ?? [])]
    .find((member) => member.username.toLowerCase() === handle);
  const member = known ?? { username: handle, displayName: handle };
  const following = action === "follow"
    ? [...data.following.filter((item) => item.username.toLowerCase() !== handle), member]
    : data.following.filter((item) => item.username.toLowerCase() !== handle);
  const followingNames = new Set(following.map((item) => item.username.toLowerCase()));
  const followerNames = new Set(data.followers.map((item) => item.username.toLowerCase()));
  const mutuals = following.filter((item) => followerNames.has(item.username.toLowerCase()));
  const notFollowingBack = following.filter((item) => !followerNames.has(item.username.toLowerCase()));
  const fans = data.followers.filter((item) => !followingNames.has(item.username.toLowerCase()));
  return {
    ...data,
    liveUpdatedAt: new Date().toISOString(),
    following,
    mutuals,
    notFollowingBack,
    fans,
    counts: {
      ...data.counts,
      following: following.length,
      mutuals: mutuals.length,
      notFollowingBack: notFollowingBack.length,
      fans: fans.length,
    },
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

function FullRatingsPanel({
  language,
  users,
  scan,
  hasSocial,
  onStart,
  previewCount,
}: {
  language: Language;
  users: UserTaste[];
  scan?: { running: boolean; text: string; members: number; loaded: number };
  hasSocial: boolean;
  onStart: (scope: RatingsScope, count: number, pages: number) => void;
  previewCount: (scope: RatingsScope, count: number) => number;
}) {
  const tr = language === "tr";
  const [scope, setScope] = useState<RatingsScope>("matches");
  const [count, setCount] = useState(50);
  const [pages, setPages] = useState(8);
  const read = users.filter((user) => user.ratingsScannedAt);
  const ratings = read.reduce((sum, user) => sum + user.films.filter((film) => film.rating !== undefined).length, 0);
  const pending = previewCount(scope, count);
  const minutes = Math.max(1, Math.round((pending * pages * 1.6) / 60));
  return (
    <details className="panel insight-tool" open={scan?.running || undefined}>
      <summary>
        <Film size={18} />
        <strong>{tr ? "Tam puan listeleri (Letterboxd film sayfalari)" : "Full rating lists (Letterboxd film pages)"}</strong>
        <small>{tr ? `${read.length} kisinin tam listesi, ${ratings} puan` : `${read.length} full lists, ${ratings} ratings`}</small>
      </summary>
      <p className="muted-line">
        {tr
          ? "RSS her uyenin yalniz son ~50 film etkinligini verir. Eklenti, giris yaptigin Letterboxd sekmesinde secilen kisilerin herkese acik film sayfalarini (72 film/sayfa) yavasca okur ve tum puanlarini eslesmeye katar. Sayfalar arasinda 1,4 sn beklenir; 429 gelirse geri cekilir. Letterboxd kosullari otomatik toplamayi sinirlar: az kisiyle ve olculu kullan."
          : "RSS shows only each member's last ~50 film events. The extension slowly reads the selected members' public film pages (72 films per page) in your logged-in Letterboxd tab and adds every rating to matching. It waits 1.4 s between pages and backs off on 429. Letterboxd's terms limit automated collection: use it sparingly."}
      </p>
      <div className="insight-tool-row">
        <label className="archive-field">
          <span>{tr ? "Kimler" : "Who"}</span>
          <select value={scope} onChange={(event) => setScope(event.target.value as RatingsScope)}>
            <option value="matches">{tr ? "En iyi eslesmeler" : "Best matches"}</option>
            <option value="mutuals" disabled={!hasSocial}>{tr ? "Karsilikli takiplesenler" : "Mutuals"}</option>
            <option value="following" disabled={!hasSocial}>{tr ? "Takip ettiklerim" : "Following"}</option>
            <option value="followers" disabled={!hasSocial}>{tr ? "Takipcilerim" : "Followers"}</option>
            <option value="directory" disabled={!hasSocial}>{tr ? "Tum dizin (ag dahil)" : "Whole directory (incl. network)"}</option>
          </select>
        </label>
        <label className="archive-field">
          <span>{tr ? "En fazla kisi" : "Max people"}</span>
          <input type="number" min={1} max={500} value={count} onChange={(event) => setCount(Math.min(500, Math.max(1, Number(event.target.value) || 1)))} />
        </label>
        <label className="archive-field">
          <span>{tr ? "Kisi basina sayfa (72 film)" : "Pages per person (72 films)"}</span>
          <input type="number" min={1} max={40} value={pages} onChange={(event) => setPages(Math.min(40, Math.max(1, Number(event.target.value) || 1)))} />
        </label>
        <button className="primary-button" disabled={scan?.running || !pending} onClick={() => onStart(scope, count, pages)}>
          {scan?.running ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
          <span>{tr ? `${pending} kisinin puanlarini oku` : `Read ${pending} people's ratings`}</span>
        </button>
      </div>
      <p className="muted-line">
        {tr
          ? `Tahmini en fazla ~${minutes} dk. Son 30 gunde okunanlar atlanir. Uygulama ve Letterboxd sekmesi acik kalmali; her biten kisi hemen kaydedilir.`
          : `Estimated at most ~${minutes} min. Members read in the last 30 days are skipped. Keep the app and the Letterboxd tab open; each finished member is saved at once.`}
      </p>
      {scan && (
        <p className={`ratings-scan-status${scan.running ? " running" : ""}`} aria-live="polite">
          {scan.running && <Loader2 className="spin" size={14} />} {scan.text}
          {" · "}
          {tr ? `${scan.loaded}/${scan.members} kisi alindi` : `${scan.loaded}/${scan.members} people received`}
        </p>
      )}
    </details>
  );
}

const FILM_CONDITIONS: Array<[FilmCondition, string, string]> = [
  ["loved", "Sevdi (4+ veya kalp)", "Loved (4+ or heart)"],
  ["high", "Cok sevdi (4.5+)", "Adored (4.5+)"],
  ["disliked", "Sevmedi (2.5 ve alti)", "Disliked (2.5 or less)"],
  ["low", "Nefret etti (1.5 ve alti)", "Hated (1.5 or less)"],
  ["liked-heart", "Kalp verdi", "Gave a heart"],
  ["rated", "Puanladi", "Rated"],
  ["watched", "Izledi", "Watched"],
];

function FilmPeopleFinder({
  language,
  users,
  ownerHandle,
  social,
  matches,
  onSelectMatch,
}: {
  language: Language;
  users: UserTaste[];
  ownerHandle: string;
  social?: SocialData;
  matches: MatchResult[];
  onSelectMatch: (match: MatchResult) => void;
}) {
  const tr = language === "tr";
  const locale = tr ? "tr-TR" : "en-US";
  const [query, setQuery] = useState("");
  const [criteria, setCriteria] = useState<FilmCriterion[]>([]);
  const [options, setOptions] = useState<FilmPeopleOptions>(defaultFilmPeopleOptions);
  const [visible, setVisible] = useState(50);
  const catalog = useMemo(() => buildFilmCatalog(users), [users]);
  const catalogByKey = useMemo(() => new Map(catalog.map((entry) => [entry.key, entry])), [catalog]);
  const suggestions = useMemo(() => searchFilmCatalog(catalog, query, 12, locale).filter((entry) => !criteria.some((criterion) => criterion.key === entry.key)), [catalog, criteria, locale, query]);
  const results = useMemo(
    () => findPeopleByFilms(users, criteria, { ...options, excludeOwner: ownerHandle }),
    [criteria, options, ownerHandle, users],
  );
  const matchByHandle = useMemo(() => new Map(matches.map((match) => [match.user.handle.toLowerCase(), match])), [matches]);
  const following = useMemo(() => new Set(social?.available ? social.following.map((member) => member.username.toLowerCase()) : []), [social]);
  const followers = useMemo(() => new Set(social?.available ? social.followers.map((member) => member.username.toLowerCase()) : []), [social]);
  const owner = users.find((user) => user.handle.toLowerCase() === ownerHandle.toLowerCase());

  useEffect(() => setVisible(50), [criteria, options]);

  function addFilm(key: string) {
    if (criteria.length >= 12) return;
    setCriteria((current) => [...current, { key, condition: "loved" }]);
    setQuery("");
  }

  function pickMyFilms(kind: "loved" | "disliked") {
    if (!owner) return;
    const films = owner.films
      .filter((film) => (kind === "loved" ? (film.rating ?? 0) >= 4.5 : film.rating !== undefined && film.rating <= 2))
      .sort((a, b) => (catalogByKey.get(b.key)?.raters ?? 0) - (catalogByKey.get(a.key)?.raters ?? 0))
      .slice(0, 5);
    setCriteria(films.map((film) => ({ key: film.key, condition: kind })));
    setOptions((current) => ({ ...current, match: "any" }));
  }

  function downloadCsv() {
    const url = URL.createObjectURL(new Blob([filmPeopleCsv(results, criteria, catalogByKey, language)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `tastetwin-filmden-kisiler-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const filmLabel = (key: string) => {
    const entry = catalogByKey.get(key);
    return entry ? `${entry.title}${entry.year ? ` (${entry.year})` : ""}` : key;
  };

  return (
    <details className="panel insight-tool film-people" open={criteria.length > 0 || undefined}>
      <summary>
        <Heart size={18} />
        <strong>{tr ? "Filmden kisi bul" : "Find people by film"}</strong>
        <small>{tr ? `${catalog.length} film, ${users.length} kisi icinde` : `across ${catalog.length} films and ${users.length} people`}</small>
      </summary>
      <p className="muted-line">
        {tr
          ? "Film sec, her biri icin kosul belirle (sevdi, sevmedi, izledi...). TasteTwin'e yuklenen herkes taranir; filmi hic kaydetmemis biri \"sevmedi\" sayilmaz. Tam puan listesi okunan kisilerde sonuc cok daha eksiksizdir."
          : "Pick films and a condition for each (loved, disliked, watched...). Everyone loaded into TasteTwin is searched; someone who never logged a film is not counted as disliking it. Results are far more complete for members whose full ratings were read."}
      </p>
      <div className="insight-tool-row">
        <label className="film-search film-picker">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr ? "Film adi yaz..." : "Type a film title..."} aria-label={tr ? "Film ara" : "Search films"} />
        </label>
        <button className="browser-scan-button" onClick={() => pickMyFilms("loved")} disabled={!owner}>
          {tr ? "En sevdigim 5 film" : "My 5 favourites"}
        </button>
        <button className="browser-scan-button" onClick={() => pickMyFilms("disliked")} disabled={!owner}>
          {tr ? "En sevmedigim 5 film" : "My 5 least liked"}
        </button>
      </div>
      {suggestions.length > 0 && (
        <ul className="film-suggestions" role="listbox">
          {suggestions.map((entry) => (
            <li key={entry.key}>
              <button onClick={() => addFilm(entry.key)}>
                <strong>{entry.title}</strong> {entry.year && <span>{entry.year}</span>}
                <small>{tr ? `${entry.raters} kisi` : `${entry.raters} people`}{entry.mean !== undefined ? ` · ${tr ? "ort." : "avg"} ${entry.mean.toFixed(1)}` : ""}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {criteria.length > 0 && (
        <>
          <ul className="film-criteria">
            {criteria.map((criterion, index) => (
              <li key={criterion.key}>
                <span>{filmLabel(criterion.key)}</span>
                <select
                  value={criterion.condition}
                  aria-label={tr ? "Kosul" : "Condition"}
                  onChange={(event) => setCriteria((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, condition: event.target.value as FilmCondition } : item)))}
                >
                  {FILM_CONDITIONS.map(([value, trLabel, enLabel]) => <option key={value} value={value}>{tr ? trLabel : enLabel}</option>)}
                </select>
                <button onClick={() => setCriteria((current) => current.filter((_, itemIndex) => itemIndex !== index))} title={tr ? "Kaldir" : "Remove"}>
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="insight-tool-row">
            <label className="archive-field">
              <span>{tr ? "Eslesme" : "Match"}</span>
              <select value={options.match} onChange={(event) => setOptions((current) => ({ ...current, match: event.target.value as FilmPeopleOptions["match"] }))}>
                <option value="all">{tr ? "Tum kosullar" : "All conditions"}</option>
                <option value="any">{tr ? "En az biri (cok uyan once)" : "Any (most matches first)"}</option>
              </select>
            </label>
            <label className="archive-field">
              <span>{tr ? "\"Sevdi\" esigi" : "\"Loved\" threshold"}</span>
              <input type="number" min={0.5} max={5} step={0.5} value={options.lovedAt} onChange={(event) => setOptions((current) => ({ ...current, lovedAt: Number(event.target.value) || 4 }))} />
            </label>
            <label className="archive-field">
              <span>{tr ? "\"Sevmedi\" esigi" : "\"Disliked\" threshold"}</span>
              <input type="number" min={0.5} max={5} step={0.5} value={options.dislikedAt} onChange={(event) => setOptions((current) => ({ ...current, dislikedAt: Number(event.target.value) || 2.5 }))} />
            </label>
            <button className="browser-scan-button" onClick={downloadCsv} disabled={!results.length}>
              <Download size={15} />
              <span>CSV</span>
            </button>
            <button className="browser-scan-button" onClick={() => setCriteria([])}>
              <X size={15} />
              <span>{tr ? "Temizle" : "Clear"}</span>
            </button>
          </div>
          <p className="muted-line"><strong>{results.length}</strong> {tr ? "kisi bulundu" : "people found"}</p>
          <ol className="film-people-results">
            {results.slice(0, visible).map((result) => {
              const handle = result.user.handle.toLowerCase();
              const match = matchByHandle.get(handle);
              return (
                <li key={result.user.id}>
                  <div className="film-people-person">
                    <a href={`https://letterboxd.com/${encodeURIComponent(result.user.handle)}/`} target="_blank" rel="noreferrer">{result.user.displayName}</a>
                    <small>@{result.user.handle}</small>
                    {following.has(handle) && <span className="tag">{tr ? "takip ediyorum" : "I follow"}</span>}
                    {followers.has(handle) && <span className="tag">{tr ? "beni takip ediyor" : "follows me"}</span>}
                    <span className="tag subtle">{result.user.source === "upload" ? "export" : result.user.ratingsScannedAt ? (tr ? "tam liste" : "full list") : "RSS"}</span>
                    {match && match.commonCount > 0 && (
                      <button className="tag score-tag" onClick={() => onSelectMatch(match)}>
                        {tr ? "zevk" : "taste"} {match.score}
                      </button>
                    )}
                    <b>{result.matched}/{criteria.length}</b>
                  </div>
                  <div className="film-people-ratings">
                    {result.rows.map((row) => (
                      <span key={row.key} className={row.met ? "met" : row.film ? "seen" : "unknown"} title={filmLabel(row.key)}>
                        {filmLabel(row.key).slice(0, 28)}: {row.film?.rating !== undefined ? formatRating(row.film.rating) : row.film ? (row.film.liked ? "♥" : "✓") : "?"}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
          {results.length > visible && (
            <button className="browser-scan-button" onClick={() => setVisible((value) => value + 100)}>
              {tr ? `Daha fazla (${results.length - visible})` : `Show more (${results.length - visible})`}
            </button>
          )}
        </>
      )}
    </details>
  );
}

function FullRefreshPanel({ language, steps, running }: { language: Language; steps: FullRefreshStep[]; running: boolean }) {
  const tr = language === "tr";
  const labels: Record<FullRefreshStep["id"], [string, string]> = {
    own: tr ? ["Kendi son filmlerin", "RSS'teki yeni puan ve diary kayitlarin arsive eklenir."] : ["Your recent films", "New ratings and diary entries from RSS join your archive."],
    scan: tr ? ["Takip, takipci ve ag", "Letterboxd sekmesinde eklenti tum listeleri ve ikinci halkayi tarar; takipci gecmisi guncellenir."] : ["Following, followers, network", "The extension scans every list and the second ring in your Letterboxd tab; follower history updates."],
    activity: tr ? ["Herkesin film aktivitesi", "Takip, takipci ve ag adaylarinin RSS puanlari alinir, zevk skorlari yeniden hesaplanir."] : ["Everyone's film activity", "RSS ratings for following, followers and network candidates; taste scores are recalculated."],
    ratings: tr ? ["En iyi eslesmelerin tam puanlari", "Eklenti en iyi 40 eslesmenin Letterboxd film sayfalarini okur; RSS'teki son 50 filmle sinirli kalmaz. 30 gun icinde okunanlar atlanir."] : ["Full ratings of top matches", "The extension reads the film pages of the top 40 matches, beyond RSS's last 50 films. Members read in the last 30 days are skipped."],
    tmdb: tr ? ["TMDB film bilgisi", "Sure, tur, yonetmen, oyuncu ve oneriler eklenir (token gerekir)."] : ["TMDB film data", "Runtime, genres, directors, cast and recommendations (token required)."],
    backup: tr ? ["Bulut yedegi", "Secili senkron klasorune yedek yazilir."] : ["Cloud backup", "A backup is written to your sync folder."],
  };
  const stateText: Record<FullRefreshStep["state"], string> = tr
    ? { pending: "bekliyor", running: "suruyor", done: "tamam", failed: "basarisiz", skipped: "atlandi" }
    : { pending: "waiting", running: "running", done: "done", failed: "failed", skipped: "skipped" };
  return (
    <ol className="full-refresh-steps" aria-live="polite">
      {steps.map((step) => (
        <li key={step.id} className={step.state}>
          <span className="full-refresh-state">
            {step.state === "running" ? <Loader2 className="spin" size={14} /> : step.state === "done" ? "✓" : step.state === "failed" ? "!" : "·"}
          </span>
          <div>
            <strong>{labels[step.id][0]}</strong> <small>{stateText[step.state]}</small>
            <p>{labels[step.id][1]}</p>
          </div>
        </li>
      ))}
      {!running && (
        <li className="done">
          <span className="full-refresh-state">✓</span>
          <div><strong>{tr ? "Bitti" : "Finished"}</strong></div>
        </li>
      )}
    </ol>
  );
}

function ScoreBreakdown({ match, language }: { match: MatchResult; language: Language }) {
  const tr = language === "tr";
  const bias = match.ratingBias ?? 0;
  const biasText = Math.abs(bias) < 0.25
    ? tr ? "Ortak filmlerde ikinizin puan olcegi benzer." : "You both use a similar rating scale on common films."
    : tr
      ? `${match.user.displayName} ortak filmlerde senden ortalama ${Math.abs(bias).toFixed(1)} yildiz ${bias > 0 ? "comert" : "sert"} puanliyor.`
      : `${match.user.displayName} rates common films ${Math.abs(bias).toFixed(1)} stars ${bias > 0 ? "more generously" : "more harshly"} than you on average.`;
  const rows: Array<[string, string, string]> = [
    [
      tr ? "Yildiz farki modeli" : "Star-gap model",
      String(match.absoluteScore ?? match.rawScore),
      tr ? "0-1 fark arti, 1.5 notr, 2+ eksi; sevme/sevmeme ayrimi daha agir." : "0-1 gaps add, 1.5 is neutral, 2+ subtracts; love/hate splits weigh more.",
    ],
    [
      tr ? "Goreli siralama uyumu" : "Relative rank agreement",
      match.relativeScore === undefined ? (tr ? "yetersiz" : "too little data") : String(match.relativeScore),
      match.relativeScore === undefined
        ? tr ? "En az 4 ortak film ve kisi basina 8 puan gerekir." : "Needs 4 common films and 8 ratings per person."
        : tr
          ? `Her filmin kisinin kendi puanlari icindeki yeri karsilastirilir (Criticker yontemi). Ham uyuma %${match.relativeWeight ?? 0} etkiler.`
          : `Compares where each film sits within each person's own ratings (Criticker-style). Contributes ${match.relativeWeight ?? 0}% of raw affinity.`,
    ],
    [tr ? "Gecerlilik" : "Validity", `%${match.confidence}`, tr ? "Ortak film arttikca yukselir; dusukse skor 50'ye cekilir." : "Rises with common films; low validity pulls the score to 50."],
  ];
  return (
    <div className="score-breakdown">
      <h3>{tr ? "Puan nasil hesaplandi?" : "How the score was built"}</h3>
      <dl>
        {rows.map(([label, value, note]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd><strong>{value}</strong><span>{note}</span></dd>
          </div>
        ))}
      </dl>
      <p className="muted-line">{biasText}</p>
    </div>
  );
}

function FollowerTimeline({ language, handle, events }: { language: Language; handle: string; events: FollowerEvent[] }) {
  const [kind, setKind] = useState<"all" | FollowerEvent["kind"]>("all");
  const [visible, setVisible] = useState(30);
  const locale = language === "tr" ? "tr-TR" : "en-US";
  const summary = useMemo(() => summarizeFollowerEvents(events), [events]);
  const shown = useMemo(
    () => [...events].reverse().filter((event) => kind === "all" || event.kind === kind),
    [events, kind],
  );
  if (!events.length) return null;
  function downloadCsv() {
    const url = URL.createObjectURL(new Blob([followerEventsCsv(events, language)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `tastetwin-takipci-gecmisi-${handle}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="panel follower-timeline">
      <div className="follower-timeline-head">
        <div>
          <h2>{language === "tr" ? "Takipci gecmisi" : "Follower history"}</h2>
          <p className="muted-line">
            {language === "tr"
              ? `${summary.followed} takip, ${summary.unfollowed} takipten cikma kaydi. Tarih, degisikligi ilk goren taramadir; asil an iki tarama arasindadir.`
              : `${summary.followed} follows and ${summary.unfollowed} unfollows recorded. The date is the scan that first saw the change; it happened between two scans.`}
            {summary.repeatPeople > 0 && (language === "tr"
              ? ` ${summary.repeatPeople} kisi birden fazla kez gidip geldi.`
              : ` ${summary.repeatPeople} people changed more than once.`)}
          </p>
        </div>
        <div className="follower-timeline-actions">
          <select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setVisible(30); }}>
            <option value="all">{language === "tr" ? "Tumu" : "All"}</option>
            <option value="followed">{language === "tr" ? "Takip edenler" : "Followed"}</option>
            <option value="unfollowed">{language === "tr" ? "Takipten cikanlar" : "Unfollowed"}</option>
          </select>
          <button className="browser-scan-button" onClick={downloadCsv}>
            <Download size={16} />
            <span>CSV</span>
          </button>
        </div>
      </div>
      <ol className="follower-timeline-list">
        {shown.slice(0, visible).map((event) => (
          <li key={`${event.username}-${event.kind}-${event.detectedAt}`} className={event.kind}>
            <b>{event.kind === "followed" ? "+" : "−"}</b>
            <a href={`https://letterboxd.com/${encodeURIComponent(event.username)}/`} target="_blank" rel="noreferrer">
              {event.displayName}
            </a>
            <small>@{event.username}</small>
            <time title={event.since ? `${new Date(event.since).toLocaleString(locale)} – ${new Date(event.detectedAt).toLocaleString(locale)}` : undefined}>
              {new Date(event.detectedAt).toLocaleDateString(locale)}
            </time>
          </li>
        ))}
      </ol>
      {shown.length > visible && (
        <button className="browser-scan-button" onClick={() => setVisible((count) => count + 100)}>
          {language === "tr" ? `Daha fazla (${shown.length - visible})` : `Show more (${shown.length - visible})`}
        </button>
      )}
    </div>
  );
}

function addFollowerChanges(handle: string, payload: AvailableSocialData, saved?: SocialData): AvailableSocialData {
  const key = `tastetwin.followers.${handle}`;
  let previous: FollowerSnapshot | undefined;
  let resetRequested = false;
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null");
    resetRequested = stored?.reset === true;
    previous = Array.isArray(stored?.followers) ? stored : undefined;
  } catch {
    previous = undefined;
  }
  const savedSocial = saved?.available ? saved : undefined;
  // After a backup restore or on a new computer the browser snapshot is missing;
  // the last complete scan saved in app storage is the same baseline.
  if (!previous && !resetRequested && savedSocial && savedSocial.complete !== false && savedSocial.followers.length) {
    previous = {
      checkedAt: savedSocial.checkedAt,
      followers: savedSocial.followers,
      scanStage: savedSocial.scanStage,
      comparisonPreviousCheckedAt: savedSocial.previousCheckedAt,
      lostFollowers: savedSocial.lostFollowers,
      newFollowers: savedSocial.newFollowers,
      history: savedSocial.history,
    };
  }
  const previousEvents = resetRequested ? [] : savedSocial?.followerEvents ?? [];
  const { changes, snapshot } = computeFollowerChanges(payload, previous, previousEvents);
  if (snapshot) localStorage.setItem(key, JSON.stringify(snapshot));
  return { ...payload, ...changes };
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
    rss.set(user.handle.toLowerCase(), deriveUserActivity(mergeFilmArchive(rss.get(user.handle.toLowerCase()), user)));
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


type ScanProgress = {
  state: string;
  phase?: string;
  percent?: number;
  text?: string;
  hint?: string;
  code?: string;
  current?: number;
  total?: number;
  nodes?: number;
  candidates?: number;
  failedConnectors?: number;
  handle?: string;
  mode?: string;
  startedAt?: string;
  updatedAt?: string;
  receivedAt?: string;
  ageMs?: number;
  live?: boolean;
  stalled?: boolean;
};

type ScanCheckpointSummary = {
  handle: string;
  mode?: string;
  startedAt?: string;
  savedAt?: string;
  connectorIndex: number;
  connectorTotal: number;
  nodes: number;
  candidates: number;
};

const SCAN_ERROR_LABELS_TR: Record<string, string> = {
  "rate-limited": "Letterboxd hiz siniri (429)",
  forbidden: "Letterboxd erisimi reddetti (403)",
  cloudflare: "Letterboxd tarayici dogrulamasi istedi",
  "app-offline": "TasteTwin uygulamasina ulasilamadi",
  "tab-closed": "Letterboxd sekmesi kapandi",
  "app-restarted": "Uygulama yeniden baslatildi",
  "not-found": "Sayfa bulunamadi (404)",
  "pagination-loop": "Sayfalama dongusu",
  network: "Baglanti hatasi",
  unknown: "Bilinmeyen hata",
};

const SCAN_ERROR_LABELS_EN: Record<string, string> = {
  "rate-limited": "Letterboxd rate limit (429)",
  forbidden: "Letterboxd refused access (403)",
  cloudflare: "Letterboxd asked for a browser challenge",
  "app-offline": "Could not reach the TasteTwin app",
  "tab-closed": "The Letterboxd tab was closed",
  "app-restarted": "The app was restarted",
  "not-found": "Page not found (404)",
  "pagination-loop": "Pagination loop",
  network: "Connection error",
  unknown: "Unknown error",
};

function formatScanAge(ms: number | undefined, language: Language) {
  if (ms === undefined || !Number.isFinite(ms)) return language === "tr" ? "bilinmiyor" : "unknown";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} ${language === "tr" ? "sn" : "s"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${language === "tr" ? "dk" : "min"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${language === "tr" ? "saat" : "h"}`;
  return `${Math.round(hours / 24)} ${language === "tr" ? "gun" : "d"}`;
}

function describeScanPhase(progress: ScanProgress, language: Language) {
  if (progress.phase === "network") {
    return language === "tr"
      ? `Ag: ${progress.current ?? 0}/${progress.total ?? 0} baglayici | ${progress.nodes ?? 0} hesap | ${progress.candidates ?? 0} aday`
      : `Network: ${progress.current ?? 0}/${progress.total ?? 0} connectors | ${progress.nodes ?? 0} accounts | ${progress.candidates ?? 0} candidates`;
  }
  if (progress.phase === "following" || progress.phase === "followers") {
    const label = progress.phase === "following" ? "Following" : "Followers";
    return progress.total
      ? `${label}: ${progress.current ?? 0}/${progress.total}`
      : `${label}: ${progress.current ?? 0}`;
  }
  if (progress.phase === "retry") {
    return language === "tr" ? "Hiz sinirinda bekleniyor" : "Backing off after a rate limit";
  }
  return "";
}

/**
 * The scan itself runs inside the user's Letterboxd tab, so this panel treats
 * silence as failure: a running state whose last heartbeat is older than the
 * server's staleness window is shown as interrupted, never as "still working".
 */
function ScanStatusPanel({
  handle,
  language,
  onResume,
}: {
  handle: string;
  language: Language;
  onResume: (resume: boolean) => void;
}) {
  const [progress, setProgress] = useState<ScanProgress>();
  const [checkpoint, setCheckpoint] = useState<ScanCheckpointSummary>();
  const [cancelling, setCancelling] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!handle) return undefined;
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/extension/progress?handle=${encodeURIComponent(handle)}`);
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled) return;
        setProgress(payload.progress);
        setCheckpoint(payload.checkpoint);
      } catch {
        // The local server is part of the app; a failed poll is transient.
      }
    }

    void poll();
    const timer = window.setInterval(() => {
      void poll();
      setTick((current) => current + 1);
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [handle]);

  const running = Boolean(progress?.live);
  const stalled = Boolean(progress?.stalled);
  const ageMs = progress?.updatedAt ? Date.now() - Date.parse(progress.updatedAt) : progress?.ageMs;
  void tick;

  async function cancelScan() {
    setCancelling(true);
    try {
      await fetch("/api/extension/cancel-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-TasteTwin-Request": "app" },
        body: JSON.stringify({ handle }),
      });
    } catch {
      // The cancel flag is best effort; the extension also has its own button.
    }
  }

  if (!handle) return null;
  if (!progress && !checkpoint) return null;

  const errorLabels = language === "tr" ? SCAN_ERROR_LABELS_TR : SCAN_ERROR_LABELS_EN;
  const failed = progress?.state === "error" || progress?.state === "interrupted" || stalled;
  const cancelled = progress?.state === "cancelled";
  const done = progress?.state === "complete";
  const percent = Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)));

  const tone = failed ? "bad" : cancelled ? "warn" : running ? "live" : done ? "done" : "idle";
  const headline = failed
    ? stalled && progress?.state !== "interrupted"
      ? language === "tr"
        ? "Tarama kesilmis gorunuyor."
        : "The scan looks interrupted."
      : progress?.state === "interrupted"
        ? (language === "tr" ? "Önceki tarama yarım kaldı." : "The previous scan was interrupted.")
        : progress?.text || (language === "tr" ? "Tarama kesildi." : "The scan stopped.")
    : progress?.text || (language === "tr" ? "Tarama durumu" : "Scan status");

  return (
    <div className={`scan-status scan-status-${tone}`}>
      <div className="scan-status-head">
        <strong>{headline}</strong>
        <span>%{percent}</span>
      </div>
      <div className="scan-status-bar">
        <i style={{ width: `${percent}%` }} />
      </div>
      {progress && (
        <span className="scan-status-meta">
          {describeScanPhase(progress, language)}
          {progress.failedConnectors
            ? ` | ${progress.failedConnectors} ${language === "tr" ? "baglayici atlandi" : "connectors skipped"}`
            : ""}
        </span>
      )}
      {progress && (
        <span className="scan-status-meta">
          {language === "tr" ? "Son isaret" : "Last signal"}: {formatScanAge(ageMs, language)}{" "}
          {language === "tr" ? "once" : "ago"}
          {progress.startedAt
            ? ` | ${language === "tr" ? "toplam" : "elapsed"} ${formatScanAge(Date.now() - Date.parse(progress.startedAt), language)}`
            : ""}
        </span>
      )}
      {progress?.code && errorLabels[progress.code] && (
        <span className="scan-status-code">{errorLabels[progress.code]}</span>
      )}
      {progress?.hint && <span className="scan-status-hint">{progress.hint}</span>}
      {checkpoint?.connectorIndex ? (
        <span className="scan-status-meta">
          {language === "tr"
            ? `Kayitli ilerleme: ${checkpoint.connectorIndex}/${checkpoint.connectorTotal} baglayici, ${checkpoint.candidates} aday`
            : `Saved progress: ${checkpoint.connectorIndex}/${checkpoint.connectorTotal} connectors, ${checkpoint.candidates} candidates`}
        </span>
      ) : null}
      <div className="scan-status-actions">
        {running && (
          <button className="browser-scan-button" onClick={cancelScan} disabled={cancelling}>
            <X size={15} />
            <span>{cancelling ? (language === "tr" ? "Iptal isteniyor" : "Cancelling") : language === "tr" ? "Taramayi iptal et" : "Cancel scan"}</span>
          </button>
        )}
        {!running && checkpoint?.connectorIndex ? (
          <button className="browser-scan-button" onClick={() => onResume(true)}>
            <RefreshCcw size={15} />
            <span>
              {language === "tr"
                ? `Kaldigi yerden devam et (${checkpoint.connectorIndex}/${checkpoint.connectorTotal})`
                : `Resume (${checkpoint.connectorIndex}/${checkpoint.connectorTotal})`}
            </span>
          </button>
        ) : null}
        {!running && failed && progress?.mode !== "ratings" && (
          <button className="browser-scan-button" onClick={() => onResume(false)}>
            <Globe2 size={15} />
            <span>{language === "tr" ? "Bastan tara" : "Scan from scratch"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
