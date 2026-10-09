import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConversationPeople,
  checkCommentTone,
  closenessScore,
  findHiddenOwnComments,
  parseCommentsSectionHtml,
  parseOwnCommentsCsv,
  unansweredOnMyContent,
  type ConversationThread,
} from "../src/lib/conversations";

const ME = "ricksanchez779";
const NOW = new Date("2026-09-26T12:00:00Z");
const c = (author: string, at: string, text = "x") => ({ author, at, text });

// Shape copied from a real /csi/viewing/<id>/comments-section/ response (26.09.2026).
const SECTION = `
<ul class="comment-list">
<li id="comment-53014459" class="comment" data-edit-url="/ajax/viewingComment:53014459/edit-comment/" data-delete-url="/ajax/viewingComment:53014459/delete-comment/" data-comment-id="53014459" data-person="fierths" data-creation-timestamp="1790377093079">
 <div class="person-summary -small col-5 js-comment-person"> <a class="avatar -a24" href="/fierths/"><img alt="edaa&#x1f41a;"></a>
 <strong class="name"><a href="/fierths/">edaa🐚</a></strong>
 <small class="metadata"><a class="comment-permalink" href="#comment-53014459"><span class="time"><time datetime="2026-09-25T22:58:13.079Z">x</time></span></a></small></div>
 <div class="comment-body body-text -small"><p>isminin its always sunny mention oldugunu simdi fark ettim cok tatli&#39;&#128557;</p></div>
</li>
<li id="comment-2" class="comment" data-comment-id="2" data-person="ricksanchez779" data-delete-url="/ajax/viewingComment:2/delete-comment/">
 <strong class="name"><a href="/ricksanchez779/">Rickety Cricket</a></strong><time datetime="2026-09-26T08:00:00Z">x</time>
 <div class="comment-body body-text -small"><p>line one</p><p>Tom &amp; Jerry</p></div>
</li>
</ul>`;

test("comments-section fragment parses without a DOM", () => {
  const [first, second] = parseCommentsSectionHtml(SECTION);
  assert.equal(first.author, "fierths");
  assert.equal(first.authorName, "edaa🐚");
  assert.equal(first.id, "53014459");
  assert.equal(first.at, "2026-09-25T22:58:13.079Z");
  assert.equal(first.deleteUrl, "/ajax/viewingComment:53014459/delete-comment/");
  assert.match(first.text, /cok tatli'😭$/);
  assert.equal(second.text, "line one\nTom & Jerry");
});

test("export comments.csv with quotes, commas and multiline text", () => {
  const rows = parseOwnCommentsCsv('﻿Date,Content,Comment\n2025-02-10,https://boxd.it/63bVcl,"Selo, naber ""ya""\nikinci satir"\n\n');
  assert.deepEqual(rows, [{ at: "2025-02-10", target: "https://boxd.it/63bVcl", text: 'Selo, naber "ya"\nikinci satir' }]);
  assert.throws(() => parseOwnCommentsCsv("Name,Year\nX,2020"));
});

test("people: owner of a post you commented on counts even if silent; strangers in big threads do not", () => {
  const bigThread: ConversationThread = {
    url: "/mank/film/there-will-be-blood/", owner: "mank",
    comments: [
      ...Array.from({ length: 40 }, (_, i) => c(`stranger${i}`, `2025-06-${String((i % 28) + 1).padStart(2, "0")}`)),
      c(ME, "2025-06-29"),
      c("replier", "2025-06-30"),
      c("latecomer1", "2025-07-01"), c("latecomer2", "2025-07-02"), c("latecomer3", "2025-07-03"),
    ],
  };
  const people = buildConversationPeople([bigThread], ME, NOW);
  const handles = people.map((p) => p.handle).sort();
  assert.deepEqual(handles, ["latecomer1", "latecomer2", "mank", "replier"]);
  const mank = people.find((p) => p.handle === "mank")!;
  assert.equal(mank.twoWay, false);
  assert.deepEqual(mank.kinds, ["their-post"]);
});

test("people: two-way friend outranks one-way stranger; waitingForMe on my own review", () => {
  const threads: ConversationThread[] = [
    { url: "/esdeezade/film/a/", owner: "esdeezade", comments: [c(ME, "2026-08-20"), c("esdeezade", "2026-08-21"), c(ME, "2026-08-22"), c("esdeezade", "2026-08-24")] },
    { url: "/esdeezade/film/b/", owner: "esdeezade", comments: [c(ME, "2026-03-04"), c("esdeezade", "2026-03-05")] },
    { url: "/random/film/c/", owner: "random", comments: [c(ME, "2025-01-01")] },
    { url: `/${ME}/film/the-invite-2026/`, owner: ME, title: "The Invite", comments: [c("fierths", "2026-09-25T22:58:13Z", "cok tatli")] },
  ];
  const people = buildConversationPeople(threads, ME, NOW);
  assert.equal(people[0].handle, "esdeezade");
  assert.equal(people[0].threads, 2);
  assert.equal(people[0].myMessages, 3);
  assert.equal(people[0].theirMessages, 3);
  assert.equal(people[0].lastAt, "2026-08-24");
  const random = people.find((p) => p.handle === "random")!;
  assert.ok(random.closeness < people[0].closeness);
  assert.equal(people.find((p) => p.handle === "fierths")!.waitingForMe, true);
  assert.deepEqual(unansweredOnMyContent(threads, ME).map((u) => [u.from, u.title]), [["fierths", "The Invite"]]);
});

test("closeness decays with time and rewards reciprocity", () => {
  const base = { myMessages: 5, theirMessages: 5, threads: 3 };
  const fresh = closenessScore({ ...base, lastAt: "2026-09-20" }, NOW);
  const stale = closenessScore({ ...base, lastAt: "2025-03-01" }, NOW);
  const oneWay = closenessScore({ myMessages: 10, theirMessages: 0, threads: 3, lastAt: "2026-09-20" }, NOW);
  assert.ok(fresh > stale && stale > 0);
  assert.ok(fresh > oneWay);
  assert.equal(closenessScore({ myMessages: 0, theirMessages: 0, threads: 0, lastAt: "" }, NOW), 0);
  assert.ok(fresh <= 100);
});

test("hidden own comments: export rows missing from visible threads", () => {
  const rows = [
    { at: "2026-04-01", target: "https://boxd.it/dJNse3", text: "Sen nası bi anlamda kullanıyosun" },
    { at: "2026-09-20", target: "https://boxd.it/gmMLGP", text: "Haftada 1 olur ya  kesin" },
  ];
  const visible = [{ author: ME, at: "2026-09-20", text: "haftada 1 olur ya kesin" }];
  assert.deepEqual(findHiddenOwnComments(rows, visible, ME).map((r) => r.target), ["https://boxd.it/dJNse3"]);
});

test("tone check: Turkish folding, 'sikici' (boring) is not profanity, aimed insults escalate", () => {
  assert.equal(checkCommentTone("Ama film cok sikici degil miydi").level, "ok");
  assert.equal(checkCommentTone("Çok sık izliyorum bu tarz filmleri").level, "ok");
  assert.equal(checkCommentTone("Sıkıntı yok izle").level, "ok");
  assert.equal(checkCommentTone("Die Hard kesinlikle izle").level, "ok");
  assert.equal(checkCommentTone("Neresi muhtesem amk").level, "harsh");
  assert.equal(checkCommentTone("Bu filmi seven direkt ölsün").level, "harsh");
  assert.equal(checkCommentTone("you stupid mf").level, "risky");
  assert.equal(checkCommentTone("Mal olsan mal oldugunu dusunmezdin, sen gerzek misin").level, "risky");
  assert.deepEqual(checkCommentTone("Cok fazla erkek vardı tecavüze uğradım").reasons, ["tecavuz sakasi"]);
  assert.deepEqual(checkCommentTone("İNCEL olduğum doğru da ... 17 cm güzel sikim var").reasons, ["cinsel icerik"]);
  assert.equal(checkCommentTone("Zenci işi filmleri çok abartıyo").level, "risky");
  assert.equal(checkCommentTone("why dont you just kill yourself").level, "risky");
});
