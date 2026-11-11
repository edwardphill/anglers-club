// The three product pages search engines and AI tools should find Fly AI by: the AI fly fishing picker, the AI fly guide and
// fly shop discoverability. Server-rendered HTML with the facts in the text (nothing here needs JavaScript to read),
// a FAQ, and schema.org data. Numbers come from the Fly Picker's own data so the copy can't drift from what it does.
// Pure functions; api/page.js serves them.
import { createRequire } from "node:module";
import { layout, esc, riverSlug } from "./pages.js";
import { RIVERS, LIVE_DAYS } from "./shops.js";
import { BRAND, LANDING_UPDATED, orgLd, siteLd, faqLd } from "./brand.js";

const FP = createRequire(import.meta.url)("../data/flypicker.json");

const stats = () => {
  const src = FP.sources.sources;
  return { flies: Object.keys(FP.flies).length, reports: src.length, sites: new Set(src.map((s) => s.site)).size, rivers: Object.keys(FP.rivers).length, waterTypes: Object.keys(FP.water_types).length };
};
const riverList = () => Object.values(RIVERS).sort((a, b) => a.name.localeCompare(b.name));
const faqHtml = (items) => `<h2>Questions</h2>\n${items.map(([q, a]) => `<h3>${esc(q)}</h3>\n<p>${a}</p>`).join("\n")}`;
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const page = ({ base, path, title, description, h1, body, faq, extra = [] }) => {
  const url = base + path;
  const data = { "@context": "https://schema.org", "@graph": [orgLd(base), siteLd(base),
    { "@type": "WebPage", "@id": url, url, name: title, description, inLanguage: "en-US", isPartOf: { "@id": base + "/#site" }, dateModified: LANDING_UPDATED,
      breadcrumb: { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: BRAND, item: base + "/" }, { "@type": "ListItem", position: 2, name: h1, item: url }] } },
    ...extra, faqLd(faq.map(([q, a]) => [q, plain(a)]))] };
  return layout({ base, path, title, description, ld: data, body: `<h1>${esc(h1)}</h1>\n${body}\n${faqHtml(faq)}` });
};
const app = (base, name, desc, path, features) => ({ "@type": "SoftwareApplication", "@id": base + path + "#app", name, description: desc, url: base + path, applicationCategory: "SportsApplication", operatingSystem: "Any (web browser)", featureList: features, publisher: { "@id": base + "/#org" } });

// ---------- AI fly fishing picker ----------

export function flyPickerPage({ base }) {
  const s = stats(), rivers = riverList();
  const faq = [
    ["Is the fly picker really AI?", `It is a rules engine, not a chatbot. It scores flies against hatch charts and dated reports and shows the reports it used; it doesn't write answers or invent flies. The part of ${BRAND} that uses a language model is the <a href="/ai-fly-guide">AI fly guide</a>.`],
    ["Which rivers does it cover?", `${s.rivers} rivers have reports of their own: ${rivers.map((r) => r.name).join(", ")}. Anywhere else it works from the hatch chart for your region and water type, and says so.`],
    ["Where do the reports come from?", `Dated posts that local fly shops, guides and blogs published themselves. Each pick links to the reports that named the fly. ${BRAND} keeps fly names, dates, links and short notes, not the posts themselves.`],
    ["Which kinds of water and fish does it handle?", `${s.waterTypes} kinds of water: freestone rivers, tailwaters, spring creeks, small mountain streams, trout lakes, bass ponds and warm lakes, warmwater rivers, saltwater flats, ocean surf and estuaries.`],
    ["Can it tell me what is hatching today?", "It shows what the hatch chart expects for the date, region and water type, and adjusts for water temperature, sky, wind and flow. For a current read, the river pages carry the latest shop reports with their dates."],
  ];
  const body = `<p class="lede">Pick a river and a date. The Fly Picker shows what's hatching and ranks the flies most likely to get eaten, with the shop, guide and blog reports behind each pick.</p>
<p><a class="cta" href="/picker">Open the Fly Picker</a> <a class="cta ghost" href="/rivers">River reports</a></p>
<p class="muted">Free and open to everyone: no club, no sign-in.</p>
<h2>How it picks flies</h2>
<ol class="plain">
<li><strong>What's hatching.</strong> It starts from a hatch chart for the month, region and water type: the insects and other foods on the water.</li>
<li><strong>What local reports say.</strong> It matches ${s.reports} dated reports from ${s.sites} fly shops, guides and blogs to the flies in its ${s.flies}-fly catalog. Each pick lists the reports that named it, with links. Reports from your own river come first, and when a river has none the pick says so instead of passing off another river's reports as yours.</li>
<li><strong>Conditions.</strong> Water temperature, sky, wind and flow adjust the ranking and the advice at the top of the list, such as tying on a dry only if fish are rising.</li>
<li><strong>Your kind of fly.</strong> Narrow it to dry flies, emergers, nymphs, wet flies and soft hackles, streamers, poppers or saltwater flats flies.</li>
</ol>
<h2>A rules engine, not a chatbot</h2>
<p>Every fly comes from a catalog of ${s.flies} patterns and every citation is a real, dated report. Nothing is generated. That is why it can show its work, and why it will say "no reports for this river" when that is the case.</p>
<h2>Rivers with their own reports</h2>
<ul class="plain">${rivers.map((r) => `<li><a href="/rivers/${esc(riverSlug(r.key))}">${esc(r.name)}</a>${r.state ? " (" + esc(r.state) + ")" : ""}</li>`).join("")}</ul>
<p class="muted">The picker also covers ${s.waterTypes} kinds of water in four US regions: Southeast and Gulf, Northeast, East and Midwest, and West.</p>`;
  const description = `Fly Picker ranks flies for your river and date from hatch charts and ${s.reports} dated shop, guide and blog reports, and links the reports behind each pick.`;
  const feat = ["Ranks flies for a river or water type and date", "Shows what is hatching from a hatch chart", `Cites dated reports from ${s.sites} shops, guides and blogs`, `${s.flies}-fly catalog`, `${s.waterTypes} water types, trout to saltwater`];
  return page({ base, path: "/fly-picker", title: `AI fly fishing picker: which fly to tie on, by river and date | ${BRAND}`, description, h1: "AI fly fishing picker", body, faq, extra: [app(base, `${BRAND} Fly Picker`, description, "/fly-picker", feat)] });
}

// ---------- AI fly guide ----------

export function aiGuidePage({ base }) {
  const faq = [
    ["What is an AI fly guide?", `Software that answers trip questions: where to fish, when, and what to expect. It is not a person. For a guided day, ${BRAND} lists <a href="/guides">fly fishing guides</a> who sign up, with their Instagram and the shops they work with.`],
    ["What does it look at?", "What is hatching, the state's trout stocking schedule, dam generation schedules for the tailwaters it knows, the weather, a club's recent trip reports when you ask inside a club, and guides who list themselves near you. It may also search the web. The sources it used are listed under the answer."],
    ["Does it show where its facts came from?", "Yes. Answers list the sources they used. It names guides who signed up on Fly AI first and labels anyone else as not on Fly AI, and it is told never to guess a guide's prices."],
    ["Can it be wrong?", "Yes. Check flows, closures and regulations with the agency or the dam operator before you go. Stocking and dam generation data cover Tennessee today."],
    ["Where do I use it?", `At <a href="/plan">/plan</a>: pick the state you fish in, add the nearest town if you like, and ask. It is open to everyone, with no club and no sign-in. Inside a <a href="/clubs">club</a> it also reads the club's own trip reports.`],
    ["Is there a limit?", "Yes. It is capped each day per device so it stays free for everyone; adding a name raises your allowance."],
  ];
  const body = `<p class="lede">Ask where and when to fish in plain words. The answer weighs what's hatching, the stocking schedule, dam generation, the weather and recent reports, and links where each fact came from.</p>
<p><a class="cta" href="/plan">Ask the AI fly guide</a> <a class="cta ghost" href="/fly-picker">See the fly picker</a></p>
<p class="muted">Free and open to everyone: pick your state and ask. No club, no sign-in.</p>
<h2>Questions it answers</h2>
<ul class="plain"><li>I have tomorrow off. Should I fish the Elk or the Caney Fork?</li><li>Where should I fish this Saturday?</li><li>What's eating on the South Holston this week?</li><li>Anything stocked within an hour in the next 10 days?</li><li>Is there a guide who floats the Watauga?</li></ul>
<h2>What goes into an answer</h2>
<ul class="plain">
<li><strong>Hatches and flies</strong> from the <a href="/fly-picker">Fly Picker</a>.</li>
<li><strong>Stocking dates</strong> from the state schedule, with every stocked water on a map.</li>
<li><strong>Dam generation</strong> schedules for the tailwaters it knows, linked to the operator.</li>
<li><strong>Weather and water</strong> for the day you ask about.</li>
<li><strong>A club's reports</strong> from recent trips, when you ask from inside a club.</li>
<li><strong>Guides near you</strong> who listed themselves, with Instagram and shops, so you can message them.</li>
</ul>
<h2>Built on sources</h2>
<p>The planner is the language-model part of ${BRAND}. It is told to cite its sources, to name signed-up guides first and label everyone else, and never to guess a guide's prices. It is a planning aid. It doesn't replace the agency, the dam operator or a local shop.</p>`;
  const description = "Ask Fly AI's AI fly guide where and when to fish. Answers weigh hatches, stocking, dam generation, weather and recent reports, and link the source of each fact.";
  return page({ base, path: "/ai-fly-guide", title: `AI fly guide: ask where and when to fish, with sources | ${BRAND}`, description, h1: "AI fly guide", body, faq,
    extra: [app(base, `${BRAND} AI fly guide`, description, "/ai-fly-guide", ["Answers where and when to fish", "Weighs hatches, stocking, dam generation, weather and recent reports", "Links the source of each fact", "Names guides who list themselves"])] });
}

// ---------- river report tool ----------

export function riverReportToolPage({ base }) {
  const rivers = riverList();
  const faq = [
    ["What does a fly shop have to do?", "Photograph the weekly whiteboard and upload the photo. That is the whole job. Fly AI turns the photo into text; the shop reads it over and publishes."],
    ["Why turn the photo into words?", "An image alone can't be read. Search engines and AI tools see a picture, not what is written on the board. The tool writes out what the board says and describes the photo in a line, so the report can be found, quoted and linked."],
    ["Can it read handwriting?", "It reads handwriting and print, and a clear, straight-on photo helps. It can still misread a number, which is why the shop checks every report before it goes live and can fix anything."],
    ["What if the board covers several rivers?", "One photo can make a report for each river on it, up to six. Each report holds only what the board says about that river."],
    ["Which rivers does it cover?", `The ${rivers.length} rivers that ${BRAND} has pages for: ${rivers.map((r) => r.name).join(", ")}. Other waters on a board aren't turned into reports yet.`],
    ["Does it make anything up?", "It is told to copy numbers, names and sizes as written, to leave a field blank when the board doesn't say, and never to add a fly, hatch, flow or date. Words written on the board are treated as the report, not as instructions to the tool."],
    ["Who can post for a shop?", "Shops are added by invitation today. The owner signs in with the Google address on the invite and can invite staff."],
    ["How long does a report stay current?", `A report is shown as current for ${LIVE_DAYS} days, then moves to the shop's archive with its date.`],
  ];
  const body = `<p class="lede">Fly shops write their river report on a whiteboard every week. Photograph it. ${BRAND} turns the photo into a dated, written river report for each river on the board, and describes the photo in words.</p>
<p><a class="cta" href="/shops">See shops already listed</a> <a class="cta ghost" href="/for-shops">Why it helps shops get found</a></p>
<h2>How it works</h2>
<ol class="plain">
<li><strong>Photograph the board.</strong> A whiteboard, a printed sheet, or a screenshot of the shop's email or post.</li>
<li><strong>${BRAND} transcribes it.</strong> For each river on the board: the date, flow, clarity, water temperature, hatches, the flies with sizes, and where and how to fish. It also writes a one-line description of the photo.</li>
<li><strong>The shop checks the text.</strong> Nothing goes live until the shop publishes. Fix a number, delete a line or leave a river out.</li>
<li><strong>It is published as text.</strong> On the shop's page, on each river's page, and in the Fly Picker's results for the river, with the date and the shop's name.</li>
</ol>
<h2>What gets published</h2>
<p>The written report and the photo's description go on the page as plain text, so search engines and AI tools can read them. The photo is shown with its description as alt text. Phone numbers and email addresses are left out of the draft, and the shop can remove anything else before publishing. We don't scrape Instagram or other sites.</p>
<h2>Rivers it covers</h2>
<ul class="plain">${rivers.map((r) => `<li><a href="/rivers/${esc(riverSlug(r.key))}">${esc(r.name)}</a>${r.state ? " (" + esc(r.state) + ")" : ""}</li>`).join("")}</ul>`;
  const description = "Photograph your weekly whiteboard and Fly AI turns it into a dated, written river report for each river on it, with the photo described in words. You check it, then publish.";
  const feat = ["Transcribes a whiteboard or printed report photo into text", "One report per river on the board", "Describes the photo in words so it can be read", "Shop checks and publishes every report", "Published on the shop page, the river page and the Fly Picker"];
  return page({ base, path: "/river-report-tool", title: `River report tool: turn your weekly whiteboard photo into a fishing report | ${BRAND}`, description, h1: "River report tool", body, faq,
    extra: [app(base, `${BRAND} River report tool`, description, "/river-report-tool", feat)] });
}

// ---------- club calendar ----------

export function clubsPage({ base }) {
  const faq = [
    ["What is a club on Fly AI?", "A shared trip calendar for a group of friends, a club or a crew in one city: someone posts a day and a water, people RSVP, and each trip has one thread. No passwords; people add a name when they post, RSVP or comment."],
    ["Do I need a club to use Fly AI's tools?", `No. The <a href="/picker">Fly Picker</a>, the <a href="/plan">AI fly guide</a>, the <a href="/stocking">stocking calendar</a> and the <a href="/trout">trout map</a> are open to everyone. A club adds the shared calendar, and the tools inside it start from your club's city.`],
    ["How do I start one?", "Pick your city, give it a name, and send the link to your crew by text. The organizer signs in with Google or a saved name and can remove members."],
    ["Is it only for fishing?", "No. A club can be fishing, hunting or both; hunting trips have season notes and harvest reports instead of flies."],
    ["What happens after a trip?", "Past trips keep their catch reports, the flies that worked and the conditions, so the next crew can see what happened on that water."],
    ["Who can see a club?", "Anyone with the link can read the calendar. To post, RSVP or comment they add a name. Only the organizer can change club settings."],
  ];
  const body = `<p class="lede">A shared trip calendar for your fishing or hunting crew. Post the day and the water, see who's in, and keep the plan, the catch reports and the flies that worked in one place instead of five text threads.</p>
<p><a class="cta" href="/#start">Start a club</a> <a class="cta ghost" href="/picker">Try the tools first</a></p>
<h2>What a club gives you</h2>
<ul class="plain">
<li><strong>A calendar of trips</strong> with seats, a start time and a meeting place. People RSVP in, out or maybe.</li>
<li><strong>One thread per trip</strong> so the plan stays with the trip.</li>
<li><strong>Catch and harvest reports</strong> from past trips: what worked, how many, the conditions.</li>
<li><strong>The tools, tuned to your club.</strong> The <a href="/ai-fly-guide">AI fly guide</a> also reads your club's recent reports, and the <a href="/fly-picker">Fly Picker</a> and the stocking calendar start from your city.</li>
<li><strong>A trout life list</strong> your members add to as they catch each native trout and char.</li>
</ul>
<h2>How to start</h2>
<ol class="plain"><li>Pick your city and name the club.</li><li>Text the link to your crew.</li><li>Post the first trip.</li></ol>`;
  const description = "Start a fishing or hunting club for your city: a shared trip calendar with RSVPs, a thread for each trip, catch reports and a trout life list. No passwords.";
  const feat = ["Shared trip calendar with RSVPs", "One thread per trip", "Catch and harvest reports", "Trout life list", "No passwords: add a name to post"];
  return page({ base, path: "/clubs", title: `Club calendar: start a fishing or hunting club for your city | ${BRAND}`, description, h1: "Club calendar", body, faq,
    extra: [app(base, `${BRAND} Club calendar`, description, "/clubs", feat)] });
}

// ---------- fly shop discoverability ----------

export function forShopsPage({ base }) {
  const faq = [
    ["Does this guarantee that AI tools will recommend my shop?", "No. Nothing can. These are the basics that make it possible: a report that can be read as text, a date on it, your shop's name and place with it, and a page that stays at one address."],
    ["Why isn't a report on Instagram enough?", "A report that lives in an image, a story or a video is hard for search engines and AI tools to read, and it disappears from view quickly. A plain-text, dated page can be read, quoted and linked."],
    ["How do I get my shop listed?", `Shops are added by invitation today. After that the owner signs in and posts a photo of the weekly report. ${BRAND} reads the photo into a draft that you review and edit before it goes live.`],
    ["Whose words are on the page?", "Yours. The page shows the shop's report with the shop's name and the date. We don't scrape Instagram or other sites and don't rewrite your report."],
    ["How long does a report stay current?", `A report is shown as current for ${LIVE_DAYS} days, then moves to the archive with its date, so an old report is never passed off as new.`],
  ];
  const body = `<p class="lede">Anglers can ask AI tools where to fish and which shop to call. A shop's best information, the weekly river report, is often in a photo or a story those tools can't read. ${BRAND} turns it into a dated page they can.</p>
<p><a class="cta" href="/shops">See shops already listed</a> <a class="cta ghost" href="/rivers">River pages</a></p>
<h2>What ${BRAND} does for a fly shop</h2>
<ul class="plain">
<li><strong>Photo to text.</strong> Post a photo of the weekly whiteboard. The <a href="/river-report-tool">river report tool</a> reads it into a written report for each river on it (date, flow, hatches, flies, tactics) and describes the photo in words. You check it and publish.</li>
<li><strong>A page for the shop.</strong> Your reports, with dates and photos described in text, marked up as a local business (name, place, website, Instagram) with each report tied to its river.</li>
<li><strong>River pages that link to you.</strong> Each river page shows the latest shop reports, with the shop named and linked, and archives older ones with their dates.</li>
<li><strong>Found by crawlers.</strong> Your pages are in the sitemap and in <a href="/llms.txt">llms.txt</a>, and robots.txt welcomes search and AI crawlers.</li>
<li><strong>In front of anglers.</strong> The Fly Picker shows the shop's latest report for the river a member is looking at, with a link to the shop, and anglers can message the shop in the app. No email or phone number is shared.</li>
</ul>
<h2>A checklist any fly shop can use</h2>
<ol class="plain">
<li>Post the weekly report as text on a page with its own address, with the date at the top.</li>
<li>Name the river, the flow, the hatches and the flies. Those are the words anglers and AI tools ask about.</li>
<li>Describe photos in words. An image alone can't be read.</li>
<li>Keep the shop's name, address and phone the same everywhere, including your Google Business Profile.</li>
<li>Add schema.org LocalBusiness data to the shop's page.</li>
<li>Put the sitemap in Search Console, and don't block search or AI crawlers in robots.txt unless you mean to.</li>
<li>Link the shop to the guides and rivers it works with.</li>
</ol>
<p class="muted">An llms.txt file is a proposed convention. Not every AI provider has said it reads one, so treat it as a bonus, not a plan.</p>`;
  const description = "How Fly AI turns a fly shop's weekly river report into a dated, plain-text page that search engines and AI tools can read, plus a checklist any shop can use.";
  return page({ base, path: "/for-shops", title: `Fly shop AI discoverability: get your river reports found | ${BRAND}`, description, h1: "Fly shop AI discoverability", body, faq,
    extra: [{ "@type": "Service", "@id": base + "/for-shops#service", name: "Fly shop river report publishing", serviceType: "Publishing weekly fishing reports as readable, dated web pages", provider: { "@id": base + "/#org" }, audience: { "@type": "BusinessAudience", name: "Fly fishing shops" }, description }] });
}
