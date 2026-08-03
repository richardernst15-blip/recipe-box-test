// worker.js — Recipe Box, all-in-one Cloudflare Worker
//
// One Worker serves the app itself and the D1-backed API behind it:
// accounts, recipes, cook-log comments and friendships.
//
// Routes:
//   POST /api/session            -> open or create a cookbook
//   POST /api/library            -> everything visible to the signed-in user
//   POST /api/recipe/save        -> create or update ONE recipe
//   POST /api/recipe/import      -> add many recipes at once
//   POST /api/recipe/visibility  -> private <-> shared with friends
//   POST /api/recipe/delete      -> delete one recipe and its cook log
//   POST /api/recipe/merge       -> copy a friend's recipe into your cookbook
//   POST /api/recipe/claim       -> act on a scanned recipe code (preview or commit)
//   POST /api/schedule/add       -> put a recipe on the calendar for a day
//   POST /api/schedule/update    -> move a booking, or change its servings
//   POST /api/schedule/remove    -> take one off the calendar
//   POST /api/grocery/create     -> build a shopping list from a date range
//   POST /api/grocery/get        -> the items on one list
//   POST /api/grocery/save       -> rewrite the items on one list
//   POST /api/grocery/rename     -> rename a list
//   POST /api/grocery/delete     -> delete a list
//   POST /api/comment/add        -> log a cook (rating required)
//   POST /api/comment/delete     -> remove your own cook log entry
//   POST /api/friend/request     -> ask someone to be friends
//   POST /api/friend/respond     -> accept or decline a request
//   POST /api/friend/remove      -> unfriend, or cancel a request you sent
//   POST /api/friend/allow       -> let someone you declined ask again
//   *                            -> serve the app HTML
//
// Requires a D1 binding named exactly: DB  (see schema.sql)

/* ======================================================== tag taxonomy ===
   One closed vocabulary, shared by the server and the browser. A label is
   the tag: "beans" sits under both Plant protein and Other starch, but a
   recipe carries it once and either branch finds it. Group names (Beef,
   Rice, Dry heat) are selectable too, and selecting one matches every leaf
   beneath it. */
const TAG_TREE = [{"key": "meal", "name": "Meal/Dish Type", "tags": ["Breakfast", "Lunch", "Snack", "Dinner", "Main Dish", "Side Dish", "Condiment", "Seasoning", "Appetizer", "Dessert", "Drink"]}, {"key": "region", "name": "Region/Flavor", "tags": ["American", "Latin American", "European", "Mediterranean", "Middle Eastern", "African", "Asian", "Italian", "French", "Spanish", "Greek", "Mexican", "Peruvian", "Brazilian", "Japanese", "Chinese", "Korean", "Thai", "Vietnamese", "Filipino", "Indian", "Turkish", "Lebanese", "Moroccan", "German", "British", "Nordic", "Cajun", "Southern", "BBQ", "Spicy", "Sweet", "Savory", "Salty", "Tangy", "Smoky", "Rich", "Fresh/Light", "Herbal", "Citrus"]}, {"key": "effort", "name": "Effort/Ease", "tags": ["30 Minutes or Less", "30 to 60 Minutes", "1-2 Hours", "2-3 Hours", "4+ Hours", "Overnight", "One Pot", "One Pan", "Sheet Pan", "Slow Cooker"]}, {"key": "diet", "name": "Diet/Restrictions", "tags": ["Vegetarian", "Vegan", "Pescatarian", "Gluten Free", "Dairy Free", "Nut Free", "Egg Free", "Soy Free", "Shellfish Free", "Halal/Kosher", "High Protein", "Low Calorie", "Low Carb", "High Fiber", "Low Sodium", "Low Sugar", "Keto", "Paleo", "Whole Food", "Mediterranean"]}, {"key": "food", "name": "Ingredient/Food", "groups": [{"name": "Protein", "groups": [{"name": "Beef", "tags": ["Ground Beef", "Steak", "Roast", "Brisket", "Short Ribs", "Stew Meat", "Tongue"]}, {"name": "Pork", "tags": ["Ground Pork", "Tenderloin", "Chops", "Shoulder", "Belly", "Bacon", "Sausage", "Ham"]}, {"name": "Chicken", "tags": ["Breast", "Thighs", "Drumsticks", "Wings", "Whole Bird", "Ground Chicken"]}, {"name": "Other Poultry", "tags": ["Turkey", "Duck", "Quail"]}, {"name": "Lamb", "tags": ["Ground Lamb", "Chops", "Shoulder", "Leg", "Rack"]}, {"name": "Fish/Cephalopod", "tags": ["Salmon", "Trout", "Tuna", "White Fish", "Mackerel", "Sardines", "Cod", "Squid", "Octopus"]}, {"name": "Shellfish", "tags": ["Shrimp", "Scallops", "Crab", "Clams", "Mussels"]}, {"name": "Organ Meat", "tags": ["Liver", "Heart", "Kidney", "Tongue", "Bone Marrow"]}, {"name": "Eggs & Dairy", "tags": ["Eggs", "Cottage Cheese", "Yogurt", "Milk", "Cheese"]}, {"name": "Plant Protein", "tags": ["Tofu", "Tempeh", "Beans", "Lentils", "Chickpeas"]}, {"name": "Other Protein", "tags": ["Bones/Stock", "Wild Game", "Canned Fish"]}]}, {"name": "Carb", "groups": [{"name": "Potatoes", "tags": ["White/Russet Potato", "Yellow Potato", "Red Potato", "Sweet Potato", "Satsumaimo"]}, {"name": "Rice", "tags": ["White Rice", "Brown Rice", "Short Grain Rice", "Long Grain Rice", "Jasmine Rice", "Basmati Rice", "Arborio Rice", "Wild Rice"]}, {"name": "Pasta - Long", "tags": ["Spaghetti", "Linguine", "Fettuccine", "Angel Hair"]}, {"name": "Pasta - Short", "tags": ["Penne", "Macaroni", "Rigatoni", "Fusilli", "Orzo", "Couscous"]}, {"name": "Pasta - Sheet/Filled", "tags": ["Lasagna Sheets", "Ravioli", "Gyoza Wrappers", "Wonton Wrappers"]}, {"name": "Noodles (Asian)", "tags": ["Udon", "Soba", "Ramen", "Rice Noodles", "Glass Noodles"]}, {"name": "Bread", "tags": ["Sandwich Bread", "Sourdough", "Flatbread", "Tortilla", "Pita", "Naan", "Buns", "Biscuits"]}, {"name": "Grains", "tags": ["Oats", "Barley", "Quinoa", "Bulgur", "Polenta/Cornmeal", "Farro"]}, {"name": "Other Starch", "tags": ["Beans", "Lentils", "Corn", "Winter Squash", "Taro"]}]}, {"name": "Vegetable", "tags": ["Mushroom", "Eggplant", "Zucchini", "Tomato", "Cabbage", "Spinach", "Kale", "Chard", "Cauliflower", "Squash", "Peppers", "Corn", "Carrot", "Sweet Potato", "Potato", "Onion", "Spaghetti Squash", "Pumpkin", "Broccoli", "Green Beans", "Cucumber", "Lima Beans"]}, {"name": "Fruit", "tags": ["Banana", "Apple", "Blueberry", "Strawberry", "Blackberry", "Watermelon", "Orange", "Kiwi", "Grape", "Lemon", "Lime", "Pineapple", "Mango", "Pear", "Peach", "Plum", "Cherry", "Raspberry", "Grapefruit", "Pomegranate", "Avocado", "Cantaloupe", "Coconut"]}, {"name": "Dairy/Staples", "tags": ["Milk", "Flour", "Egg", "Butter", "Cheese", "Yogurt", "Cottage Cheese", "Heavy Cream", "Sugar", "Maple Syrup", "Honey", "Olive Oil", "Garlic", "Canned Tomatoes", "Sourdough Discard", "Instant Yeast", "Breadcrumbs"]}, {"name": "Liquor/Liqueur", "tags": ["Vodka", "Gin", "White Rum", "Dark/Aged Rum", "Blanco Tequila", "Reposado Tequila", "Bourbon", "Rye Whiskey", "Scotch", "Cognac/Brandy", "Mezcal", "Cacha\u00e7a", "Triple Sec / Cointreau", "Dry Vermouth", "Sweet Vermouth", "Campari", "Aperol", "Amaretto", "Coffee Liqueur (Kahl\u00faa)", "Maraschino Liqueur"]}]}, {"key": "occasion", "name": "Occasion/Season", "tags": ["Thanksgiving", "Christmas", "New Year's", "Potluck", "Weeknight", "Meal Prep", "Lunchbox", "Picnic", "Camping", "Spring", "Summer", "Fall", "Winter", "4th of July"]}, {"key": "method", "name": "Cook Method/Equipment", "groups": [{"name": "Dry Heat", "tags": ["Baked", "Roasted", "Broiled", "Seared", "Sauteed", "Pan-Fried", "Deep-Fried", "Stir-Fried", "Grilled", "Smoked", "Toasted"]}, {"name": "Moist Heat", "tags": ["Boiled", "Simmered", "Steamed", "Poached", "Blanched", "Braised", "Stewed"]}, {"name": "Slow / Pressure", "tags": ["Slow-Cooked", "Pressure-Cooked", "Sous Vide", "Confit"]}, {"name": "No Heat", "tags": ["Raw", "Marinated", "Cured", "Pickled", "Fermented", "Chilled / Frozen", "No-Cook", "Dehydrated"]}, {"name": "Equipment", "tags": ["Oven", "Stovetop", "Air Fryer", "Instant Pot", "Slow Cooker", "Grill", "Wok", "Cast Iron", "Rice Cooker", "Microwave", "Smoker"]}]}];

/* Old free-form tags -> where they land. Anything absent is dropped. */
const TAG_MIGRATION = {"baked": "Baked", "baking": "Baked", "american": "American", "breakfast": "Breakfast", "dessert": "Dessert", "dinner": "Dinner", "bread": "Bread", "asian": "Asian", "latin american": "Latin American", "chicken": "Chicken", "milk": "Milk", "pan-fried": "Pan-Fried", "rice": "Rice", "snack": "Snack", "sourdough discard": "Sourdough Discard", "french": "French", "indian": "Indian", "italian": "Italian", "japanese": "Japanese", "mexican": "Mexican", "thai": "Thai", "banana": "Banana", "beef": "Beef", "camping": "Camping", "coconut": "Coconut", "dehydrated": "Dehydrated", "flour": "Flour", "gluten-free": "Gluten Free", "ground pork": "Ground Pork", "make-ahead": "Meal Prep", "naan": "Naan", "oats": "Oats", "pasta": "Spaghetti", "salmon": "Salmon", "seasoning": "Seasoning", "side": "Side Dish", "side dish": "Side Dish", "spaghetti": "Spaghetti", "stir-fry": "Stir-Fried", "summer": "Summer", "tomato sauce": "Canned Tomatoes", "yeast dough": "Instant Yeast"};

function buildTagIndex() {
  const labels = [], canon = {}, cat = {}, kids = {};
  function push(label, catKey) {
    const k = label.toLowerCase();
    if (!canon[k]) { canon[k] = label; labels.push(label); cat[k] = catKey; }
  }
  function walk(node, catKey, ancestors) {
    (node.groups || []).forEach(function (g) {
      push(g.name, catKey);
      /* a group counts as a descendant of its parents too, so picking
         Protein reaches a recipe tagged only "Beef" */
      ancestors.forEach(function (a) { (kids[a] = kids[a] || []).push(g.name.toLowerCase()); });
      walk(g, catKey, ancestors.concat([g.name.toLowerCase()]));
    });
    (node.tags || []).forEach(function (t) {
      push(t, catKey);
      ancestors.forEach(function (a) { (kids[a] = kids[a] || []).push(t.toLowerCase()); });
    });
  }
  TAG_TREE.forEach(function (c) { walk(c, c.key, []); });
  return { labels: labels, canon: canon, cat: cat, kids: kids };
}
const TAG_INDEX = buildTagIndex();

/* A tag from anywhere (import, scrape, old row) -> its canonical spelling,
   or null if it has no home in the taxonomy. */
function canonicalTag(raw) {
  const k = String(raw || "").trim().toLowerCase();
  if (!k) return null;
  if (TAG_MIGRATION[k]) return TAG_MIGRATION[k];
  return TAG_INDEX.canon[k] || null;
}
function canonicalTags(list) {
  const out = [], seen = {};
  (list || []).forEach(function (t) {
    const c = canonicalTag(t);
    if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; out.push(c); }
  });
  return out;
}

const APP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Recipe Box" />
<meta name="theme-color" content="#f2ede1" />
<link rel="apple-touch-icon" href="/icon.png" />
<link rel="icon" href="/icon.png" />
<link rel="manifest" href="/manifest.webmanifest" />
<title>Recipe Box</title>
<style>
:root{
  --bg:#f2ede1; --card:#ffffff; --card-alt:#faf6ee;
  --ink:#221f1c; --ink-muted:#79726a; --border:#d8d0c4; --border-light:#e9e3d7;
  --accent:#8f2d24; --accent-dark:#742119; --gold:#c8850f; --green:#2f6b45;
  /* Community meals get their own colour throughout - the chip on the grid,
     the tile below it, the label in the day sheet. Blue against the accent
     red reads at a glance as "this one is not just yours", which is the only
     thing the colour has to say. */
  --meal:#1f5f8b; --meal-dark:#17486a; --meal-soft:#eaf3f9; --meal-line:#b6d4e6;
  /* What sits below the tab labels. The full safe-area inset is about 34px,
     which is generous: the home indicator is a few pixels tall sitting a
     little way up from the edge, so it wants clearing, not a whole band of
     its own. Twenty or so clears it and gives the rest back to the app.
     Declared once here because the toast and the page's own bottom padding
     both have to keep step with it. */
  --tab-pad-b: max(6px, calc(env(safe-area-inset-bottom) - 14px));
}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{
  background:var(--bg); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased; -webkit-tap-highlight-color:transparent;
}
button, input, textarea, select { font-family:inherit; }

/* The document does not scroll. #app does.
   The cream bar is the page rubber-banding: with the document scrollable, a
   drag anywhere on the grey moved the library behind the filter menu, and a
   drag past the end lifted the whole viewport - fixed overlay included -
   leaving the canvas showing along the bottom. Nothing was wrong with the
   size of the grey; it was being carried up off the screen.
   Moving the scroll inside #app ends both halves of that. #modal-root is a
   sibling of #app, not a child, so once the modal is up there is nothing
   scrollable anywhere above it and a drag has nothing left to move - no
   pinning the body, no restoring a scroll position, no jump when it closes.
   overscroll-behavior stops the bounce at the ends of the list as well, so
   the canvas never gets a chance to show through.
   It settles the viewport for good too: an unscrollable document means
   Safari stops hiding and re-showing its toolbar, so the box a fixed element
   measures itself against stops changing size underneath it. */
html{ height:100%; overflow:hidden; overscroll-behavior:none; }
body{ height:100%; overflow:hidden; overscroll-behavior:none; }
/* The notch padding moves onto the scroller with the content it is there to
   protect. Body is now a plain full-height shell, and padding on it would be
   taken out of that height rather than added to it. */
#app{ height:100%; overflow-y:auto; overscroll-behavior-y:contain;
  padding-top:env(safe-area-inset-top); }

/* The padding above only says where the content starts. It sits inside the
   scroller, so it travels with the content, and the first flick took the
   chips up under a status bar with nothing behind it - black-translucent
   means the web view owns that band and the clock is drawn straight onto
   the page. The bottom never had this problem because its inset is not
   padding at all: .tabbar is fixed, so it stays put and the list passes
   under it. This is the same arrangement for the top - something opaque,
   pinned, in the page colour - so what scrolls past is hidden rather than
   shown through. Below the modal overlay on purpose: a dialog dims the
   notch band along with everything else. Height falls to zero in a browser
   tab, where the inset is zero and the toolbar owns that band instead. */
.sb-scrim{ position:fixed; top:0; left:0; right:0; height:env(safe-area-inset-top);
  background:var(--bg); z-index:70; pointer-events:none; }

/* ---- browser tab: the document scrolls -------------------------------- */
/* iOS folds its toolbars away only in answer to the root document moving.
   The shell above deliberately stops that, and says so - an unscrollable
   document is what keeps a rubber-band drag from carrying the modal overlay
   off the screen. In the installed app that costs nothing, because there is
   no toolbar to fold. In a tab it costs the whole toolbar, permanently, and
   that is the only place the cost is paid. So the shell stays exactly as it
   is where it earns its keep, and a tab gets the document back.
   The two things the shell was quietly doing have to be replaced by hand:
     - overscroll-behavior on the root stands in for the unscrollable
       document. Safari has honoured it there since 16, which was not true
       when this was first fought over; it is the first thing to try
       removing if the toolbars still refuse to fold.
     - a modal has a live scroller under it again, so data-scroll-lock goes
       back to meaning something. setScrollLock fixes the body and holds the
       offset; without it the library scrolls behind the dialog. */
html.doc-scroll, html.doc-scroll body{ height:auto; overflow:visible; }
html.doc-scroll{ overscroll-behavior-y:none; }
/* A page with nothing to scroll never gets the bar taken back. iOS holds the
   phantom toolbar space until something makes it remeasure - a scroll, or a
   rotation, which is why landscape cleared it and why a long shopping list
   clears it and a short one does not. A document that cannot scroll never
   gives it the chance, so the calendar and a near-empty Groceries sit there
   with the gap still allocated.
   The answer is to make sure there is always a hair of scroll available. One
   pixel past the viewport is enough to count as scrollable and is far too
   little to feel or to show. vh first for anything that does not know dvh;
   dvh second so it wins where it is understood, since in a tab the viewport
   grows and shrinks as the toolbar folds and vh would be measuring the wrong
   one. Scoped to doc-scroll because the shell layout sizes itself. */
html.doc-scroll body{ min-height:calc(100vh + 1px); min-height:calc(100dvh + 1px); }
html.doc-scroll #app{ height:auto; overflow:visible; overscroll-behavior:auto; }
html.doc-scroll body[data-scroll-lock]{ position:fixed; left:0; right:0; width:100%; }

/* ---- swipe from the left edge to leave a recipe ------------------------ */
/* The page is dragged sideways by the gesture, and a transform counts
   towards what a scroller thinks it has to show - so without this the
   half-finished drag turns into somewhere you can pan to, and the page ends
   up sitting slightly off-centre with a strip of nothing beside it. clip
   rather than hidden: hidden on one axis forces the other to auto, which
   would make #app a horizontal scroller in a tab where the document is
   meant to be doing the scrolling. */
#app{ overflow-x:clip; }
html.doc-scroll #app{ overflow-x:clip; }
/* The page you are heading back to, shown behind the one you are dragging
   off. It is built by the same function that will draw that view for real a
   moment later, so what slides in is what lands - and it is drawn from the
   top, because replacing #app's contents drops the scroller to the top and
   that is where the real view will open too.
   A still, not a scroller: fixed, cropped to the window, and deaf to taps,
   since anything you could press on it is about to be replaced by the same
   thing that can be pressed for real. Below the tab bar and the status bar
   scrim in the stack, which both carry on over the top of the whole
   business the way they do on iOS. */
.sb-back{ position:fixed; inset:0; z-index:1; overflow:hidden;
  background:var(--bg); padding-top:env(safe-area-inset-top);
  pointer-events:none; will-change:transform; }
/* Held back a little so it slides in slower than the page slides off - the
   two moving at one speed reads as a single sheet, and the lag is what makes
   it read as one page coming out from under another. And shaded while it is
   still behind, coming up to full as it arrives. */
.sb-dim{ position:absolute; inset:0; background:rgba(34,31,28,.16); }

/* The page being dragged away. It needs a colour of its own now that there
   is a picture rather than bare cream underneath, height enough to cover the
   window even when the view is a short one, and an edge - the shadow is what
   makes it read as a sheet lifting off rather than as two things sliding
   past each other. */
.sb-front{ position:relative; z-index:2; background:var(--bg);
  min-height:100vh; min-height:100dvh;
  box-shadow:-3px 0 18px rgba(34,31,28,.20); will-change:transform; }

/* Worn only for the last part of the movement, once the finger is off: the
   run out to the far side, or the fall back into place. Under a finger there
   is no transition at all, or the page would lag behind the touch. */
.sb-anim{ transition:transform .24s cubic-bezier(.32,.72,0,1); }
.sb-dim.sb-anim{ transition:opacity .24s cubic-bezier(.32,.72,0,1); }
@media (prefers-reduced-motion: reduce){
  .sb-anim, .sb-dim.sb-anim{ transition:none; }
}

.font-display{ font-family:Georgia,"Iowan Old Style","Palatino Linotype",serif; font-weight:700; }
.font-mono{ font-family:"SF Mono",Menlo,Consolas,monospace; }
.wrap{ max-width:960px; margin:0 auto; padding:0 16px calc(58px + var(--tab-pad-b,20px)); }
.hidden{ display:none !important; }

/* header */
/* Three things, stacked: what the app is, who you are, what you can do.
   The name gets its own line so the icon can be the real app icon at a size
   worth looking at, and the buttons drop to the row below where they have
   room for a word rather than just a glyph. */
.header{ padding:22px 0 16px; }
.header-brand{ display:flex; align-items:center; gap:11px; }
.header-brand h1{ font-size:26px; margin:0; }
.app-icon{ width:34px; height:34px; border-radius:8px; flex-shrink:0; display:block; }
.header-row2{ display:flex; align-items:center; gap:10px; margin-top:9px; }
.header-who{ margin:0; font-size:13px; color:var(--ink-muted); min-width:0; }
.header-who b{ color:var(--ink); font-weight:600; }
.header-btns{ margin-left:auto; display:flex; gap:8px; align-items:center; flex-shrink:0; }
.bell{ position:relative; }
.dot-badge{ position:absolute; top:-4px; right:-4px; min-width:16px; height:16px; padding:0 4px; border-radius:9px; background:var(--accent); color:#fff; font-size:10px; line-height:16px; text-align:center; }

/* search + filters */
.search-wrap{ position:relative; margin-bottom:10px; }
.search-wrap input{ width:100%; padding:12px 14px 12px 40px; border-radius:10px; border:1px solid var(--border); background:#fff; font-size:15px; }
.search-wrap input:focus{ outline:2px solid var(--accent); outline-offset:-1px; }
.search-wrap .icon{ position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--ink-muted); pointer-events:none; }
.filter-row{ display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
.filter-row select{ flex:1; min-width:148px; padding:9px 10px; border-radius:9px; border:1px solid var(--border); background:#fff; font-size:13.5px; color:var(--ink); }

/* chips */
.chips{ display:flex; flex-wrap:wrap; align-content:flex-start; gap:8px; margin-bottom:16px; max-height:112px; overflow-y:auto; padding-right:2px; }
.chip{ font-size:12.5px; line-height:18px; padding:6px 13px; border-radius:999px; border:1px solid var(--border); background:#fff; color:var(--ink-muted); cursor:pointer; }
.chip.active{ background:var(--accent); border-color:var(--accent); color:#fff; }

/* buttons */
.btn{ display:inline-flex; align-items:center; gap:6px; font-size:14px; padding:9px 14px; border-radius:9px; border:1px solid var(--border); background:#fff; color:var(--ink); cursor:pointer; }
.btn:hover{ border-color:#a8a29e; }
.btn:disabled{ opacity:.4; cursor:not-allowed; }
.btn-primary{ background:var(--accent); border-color:var(--accent); color:#fff; }
.btn-primary:hover{ background:var(--accent-dark); }
.btn-ghost{ border-color:transparent; background:transparent; color:var(--ink-muted); }
.btn-sm{ padding:6px 10px; font-size:13px; }
.btn-block{ width:100%; justify-content:center; }
.btn-ok{ color:var(--green); border-color:#bcd9c5; }
.btn-no{ color:var(--accent); border-color:#e3b3ae; }

/* recipe grid / cards */
.grid-recipes{ display:grid; grid-template-columns:repeat(auto-fill,minmax(225px,1fr)); gap:14px; }
.rcard{ text-align:left; background:#fff; border:1px solid var(--border-light); border-radius:13px; padding:16px; cursor:pointer; display:flex; flex-direction:column; gap:8px; transition:border-color .15s, box-shadow .15s; }
.rcard:hover{ border-color:var(--accent); box-shadow:0 3px 12px rgba(0,0,0,.06); }
.rcard h3{ font-size:18px; margin:0; line-height:1.28; }
.rcard .desc{ font-size:13px; color:var(--ink-muted); margin:0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.tag{ font-size:11px; background:var(--bg); color:var(--ink-muted); padding:3px 9px; border-radius:999px; display:inline-block; }
.tag-row{ display:flex; flex-wrap:wrap; gap:5px; align-items:center; }
.owner-badge{ font-size:11px; color:var(--accent); background:#fbf0ef; border-radius:999px; padding:3px 9px; display:inline-block; }
.card-foot{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:auto; padding-top:4px; }
.cooked-count{ font-size:12.5px; color:var(--ink-muted); }

.stars{ display:inline-flex; align-items:center; gap:4px; font-size:12.5px; color:var(--ink-muted); }
.stars svg{ width:14px; height:14px; }
.star-filled{ fill:var(--gold); stroke:var(--gold); }
.star-empty{ fill:none; stroke:var(--border); }
.no-rating{ color:#a39a8d; font-size:12.5px; }

.pill{ display:inline-flex; align-items:center; gap:5px; font-size:11.5px; padding:4px 10px; border-radius:999px; border:1px solid var(--border); background:#fff; color:var(--ink-muted); cursor:pointer; }
.pill-shared{ color:var(--green); border-color:#bcd9c5; background:#f2f8f4; }

.empty-state{ text-align:center; padding:64px 20px; border:2px dashed var(--border); border-radius:16px; }
.empty-state p.title{ font-size:19px; margin:0 0 6px; }
.empty-state p.sub{ font-size:13.5px; color:var(--ink-muted); margin:0 0 16px; }
.empty-actions{ display:flex; justify-content:center; gap:8px; flex-wrap:wrap; }

/* detail */
.detail-top{ display:flex; align-items:center; justify-content:space-between; gap:8px; padding:20px 0 14px; }
/* Three things in a space-between row would spread the two controls to
   either end of it. They belong together, so they travel together. */
.detail-tools{ display:flex; align-items:center; gap:6px; flex-shrink:0; }
/* The name and the count are what tell you which list you are in and how far
   through it you are, and both are worth having while your thumb is halfway
   down a long shop. Sticks to whichever scroller is live - #app in the
   installed app, the document in a tab - because sticky answers to the
   nearest scrolling ancestor either way. Under the tab bar and the status
   bar scrim in the stack, so neither gets covered. */
.groc-bar{ position:sticky; top:0; z-index:40; background:var(--bg);
  padding-top:8px; padding-bottom:8px; margin-left:-16px; margin-right:-16px;
  padding-left:16px; padding-right:16px; }
.back-link{ display:inline-flex; align-items:center; gap:3px; color:var(--ink-muted); background:none; border:none; font-size:14px; cursor:pointer; padding:4px 0; }
.detail-title{ font-size:29px; margin:0 0 6px; line-height:1.15; }
.detail-desc{ color:var(--ink-muted); margin:0 0 10px; font-size:15px; }
.detail-meta{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:22px; }
.dot{ color:var(--border); }
.provenance{ font-size:12.5px; color:var(--ink-muted); background:var(--card-alt); border:1px solid var(--border-light); border-radius:9px; padding:8px 11px; margin-bottom:18px; }

.row2{ display:flex; flex-wrap:wrap; gap:14px; margin-bottom:22px; }
.panel{ flex:1; min-width:250px; background:#fff; border:1px solid var(--border-light); border-radius:13px; padding:15px 16px; }
.panel-label{ font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-muted); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; }

.scale-row{ display:flex; flex-wrap:wrap; gap:7px; align-items:center; }
.scale-btn{ padding:7px 12px; border-radius:8px; border:1px solid var(--border); background:#fff; font-size:14px; cursor:pointer; }
.scale-btn.active{ background:var(--accent); border-color:var(--accent); color:#fff; }
.scale-custom-input{ width:68px; padding:7px 8px; border-radius:8px; border:1px solid var(--border); font-size:14px; }
.makes-line{ font-size:13.5px; color:var(--ink-muted); margin:10px 0 0; }

.macro-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:6px; text-align:center; }
.macro-grid .val{ font-size:19px; }
.macro-grid .lbl{ font-size:10.5px; color:var(--ink-muted); margin-top:1px; }

.cook-columns{ display:grid; grid-template-columns:1fr; gap:26px; margin-bottom:26px; position:relative; }
@media (min-width:760px){
  .cook-columns{ grid-template-columns:1fr 1fr; gap:0; }
  .cook-columns::before{ content:""; position:absolute; left:50%; top:2px; bottom:2px; width:1px; background:var(--border-light); }
  .cook-col-left{ padding-right:32px; }
  .cook-col-right{ padding-left:32px; }
}
.col-title{ font-size:16.5px; margin:0 0 12px; padding-bottom:8px; border-bottom:1px solid var(--border-light); }
.ing-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px; }
.ing-list li{ display:flex; gap:9px; font-size:15px; line-height:1.4; }
.ing-amt{ white-space:nowrap; color:var(--ink); }
.ing-amt .alt{ color:var(--ink-muted); }
.step-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:16px; }
.step-list li{ display:flex; gap:10px; }
.step-num{ color:var(--accent); font-weight:700; }
.step-text{ font-size:15px; line-height:1.55; }
.step-timer{ display:inline-flex; align-items:center; gap:4px; font-size:12px; color:var(--ink-muted); margin-left:6px; }

.notes-box{ background:var(--card-alt); border:1px solid var(--border-light); border-radius:11px; padding:14px; font-size:14px; color:var(--ink-muted); margin-bottom:26px; }
.notes-box b{ color:var(--ink); }

.log-section{ border-top:1px solid var(--border-light); padding-top:18px; }
.log-header{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
.log-header h2{ font-size:16.5px; margin:0; }
.log-item{ display:flex; justify-content:space-between; gap:10px; padding:11px 0; border-bottom:1px solid var(--border-light); }
.log-item:last-child{ border-bottom:none; }
.log-user{ font-size:14.5px; font-weight:600; }
.log-date{ font-size:12.5px; color:var(--ink-muted); }
.log-notes{ font-size:13.5px; color:var(--ink-muted); margin:4px 0 0; line-height:1.45; }
.log-right{ display:flex; flex-direction:column; align-items:flex-end; gap:4px; }
.show-all-btn{ background:none; border:none; color:var(--accent); font-size:13.5px; padding:8px 0 0; cursor:pointer; }

.change-banner{ display:flex; align-items:center; gap:10px; background:#fdf4e4; border:1px solid #e6cf9a; color:#6b4a10; border-radius:10px; padding:10px 12px; margin-bottom:16px; font-size:13.5px; line-height:1.4; }
.change-banner .banner-text{ flex:1; min-width:0; }
.change-banner button{ flex-shrink:0; }
.change-banner .btn{ background:#fff; border-color:#e6cf9a; color:#6b4a10; }

/* forms */
.field{ margin-bottom:15px; }
.field label{ display:block; font-size:13px; color:var(--ink-muted); margin-bottom:5px; }
.field input[type=text], .field input[type=number], .field input[type=date], .field input[type=url],
.field textarea, .field select{
  width:100%; padding:9px 10px; border-radius:8px; border:1px solid var(--border); font-size:14.5px; background:#fff;
}
.field textarea{ resize:vertical; }
.two-col{ display:flex; gap:12px; }
.two-col .field{ flex:1; }
.seg{ display:flex; gap:8px; }
.seg button{ flex:1; padding:11px 8px; border-radius:9px; border:1px solid var(--border); background:#fff; font-size:13.5px; color:var(--ink-muted); cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; }
.seg button.active{ background:var(--accent); border-color:var(--accent); color:#fff; }
.req-note{ font-size:12.5px; color:var(--accent); margin:6px 0 0; }

.subhead-row{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.subhead-row .small-label{ font-size:13px; color:var(--ink-muted); }

.ing-row{ background:var(--card-alt); border-radius:10px; padding:9px; margin-bottom:7px; }
.ing-grid{ display:grid; grid-template-columns:1fr 0.9fr 1fr 0.9fr auto auto; gap:6px; margin-bottom:6px; align-items:center; }
.ing-grid input, .ing-grid select{ padding:7px 8px; border-radius:6px; border:1px solid var(--border); font-size:13px; width:100%; background:#fff; }
.ing-name-input{ width:100%; padding:8px 9px; border-radius:6px; border:1px solid var(--border); font-size:14.5px; font-weight:600; margin-bottom:6px; }
.ing-notes-input{ width:100%; padding:7px 8px; border-radius:6px; border:1px solid var(--border); font-size:13px; }
.icon-btn{ border:none; background:none; cursor:pointer; color:var(--ink-muted); padding:4px; display:flex; align-items:center; justify-content:center; }
.icon-btn:hover{ color:var(--accent); }

.step-row{ background:var(--card-alt); border-radius:10px; padding:9px; margin-bottom:7px; display:flex; gap:8px; align-items:flex-start; }
.step-row .step-idx{ color:var(--accent); font-weight:700; padding-top:8px; width:16px; text-align:center; flex-shrink:0; }
.step-row textarea{ flex:1; min-width:0; padding:7px 8px; border-radius:6px; border:1px solid var(--border); font-size:13.5px; resize:vertical; }
.step-row .timer-input{ width:56px; padding:7px 6px; border-radius:6px; border:1px solid var(--border); font-size:13px; margin-top:1px; }
.step-controls{ display:flex; flex-direction:column; }

.macro-edit-grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-bottom:8px; }
@media (min-width:480px){ .macro-edit-grid{ grid-template-columns:repeat(4,1fr); } }
.macro-edit-grid input{ padding:8px; border-radius:7px; border:1px solid var(--border); font-size:13.5px; width:100%; }

.edit-actions{ display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }

/* welcome */
.welcome-wrap{ max-width:440px; margin:0 auto; padding:44px 18px 80px; }
.welcome-wrap h1{ font-size:30px; margin:14px 0 6px; }
.welcome-wrap .lede{ font-size:14.5px; color:var(--ink-muted); margin:0 0 22px; line-height:1.5; }
.warn-box{ background:#fdf4e4; border:1px solid #e6cf9a; color:#6b4a10; font-size:12.5px; line-height:1.55; padding:11px 12px; border-radius:9px; margin:0 0 16px; }
.warn-box b{ color:#4d340a; }
.code-box{ font-size:17px; letter-spacing:.1em; background:var(--card-alt); border:1px solid var(--border-light); border-radius:9px; padding:13px; text-align:center; margin-bottom:10px; word-break:break-all; }

/* friends */
.section-label{ font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-muted); margin:24px 0 4px; }
.friend-row{ display:flex; align-items:center; gap:9px; padding:12px 0; border-bottom:1px solid var(--border-light); }
.friend-name{ flex:1; font-size:15px; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.friend-sub{ font-size:12px; color:var(--ink-muted); }
.add-friend-row{ display:flex; gap:8px; }
.add-friend-row input{ flex:1; min-width:0; padding:10px 11px; border-radius:9px; border:1px solid var(--border); font-size:15px; background:#fff; }

/* modal */
/* Centred at every width, so there is always a band of grey above and below
   the card. Three rules keep it honest:
     - the overlay is sized from the viewport that is actually on screen,
       reported by visualViewport and handed over in --vv-*. The unscrollable
       document above is what stops the grey from being carried off the
       screen; this is what keeps it the right size while it is there, and it
       is the part that earns its keep when the keyboard is up - vv.height
       stops above the keys, so a modal centres in the room that is left
       rather than sitting half underneath them.
     - top and height come from one reading of one object, so they cannot
       anchor to different viewports. That was the real hazard behind the old
       warning against mixing top with a vh/dvh height, not the two
       properties themselves.
     - the card is capped with max-height:100%, a percentage of that same
       overlay rather than a viewport unit, so the two can never disagree.
   With no visualViewport the vars stay unset and the fallbacks below are
   exactly the old inset:0 box. The safe-area padding keeps the grey clear of
   the notch and the home indicator instead of tucking underneath them. */
.modal-overlay{ position:fixed; top:var(--vv-top,0px); left:var(--vv-left,0px);
  width:var(--vv-width,100%); height:var(--vv-height,100%);
  background:rgba(34,31,28,.5); display:flex;
  align-items:center; justify-content:center; z-index:80; overscroll-behavior:contain;
  padding:calc(20px + env(safe-area-inset-top)) 20px calc(20px + env(safe-area-inset-bottom)); }
.modal-box{ background:#fff; width:100%; max-width:560px; max-height:100%; overflow-y:auto;
  overscroll-behavior:contain; border-radius:16px; padding:22px; }
.modal-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
.modal-head h3{ margin:0; font-size:19px; }
.modal-close{ border:none; background:none; color:var(--ink-muted); cursor:pointer; padding:4px; }

.helper-text{ font-size:13px; color:var(--ink-muted); margin-bottom:14px; line-height:1.5; }
.help-list{ margin:0 0 4px; padding-left:18px; font-size:13.5px; line-height:1.55; color:var(--ink-muted); }
.help-list li{ margin-bottom:7px; }
.help-list b{ color:var(--ink); font-weight:600; }
.step-block{ margin-bottom:16px; }
.step-block .step-label{ font-size:12.5px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:var(--ink-muted); margin-bottom:6px; }
.prompt-box{ width:100%; height:170px; font-family:"SF Mono",Menlo,Consolas,monospace; font-size:11.5px; line-height:1.4; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--card-alt); resize:vertical; }
.response-box{ width:100%; height:110px; font-family:"SF Mono",Menlo,Consolas,monospace; font-size:12px; padding:10px; border-radius:8px; border:1px solid var(--border); resize:vertical; }
.modal-error{ background:#fbeceb; border:1px solid #e3b3ae; color:var(--accent-dark); font-size:13px; padding:9px 11px; border-radius:8px; margin-bottom:12px; }
.import-summary{ background:var(--card-alt); border:1px solid var(--border-light); border-radius:10px; padding:12px; margin-bottom:12px; font-size:13.5px; }
.import-summary ul{ margin:8px 0 0; padding-left:18px; max-height:130px; overflow-y:auto; color:var(--ink-muted); }

/* ---- tab bar ---------------------------------------------------------- */
/* A sibling of #app rather than a child. Fixed inside the scroller is the
   thing that already went wrong once here: a drag carries a fixed child up
   off the screen with the content. Outside it, the bar is nailed to the
   window and the list slides underneath it, which is what it is for.
   It sits below the modal overlay (z-index 80) on purpose - a dialog is
   meant to cover the whole app, tabs included. */
.tabbar{ position:fixed; left:0; right:0; bottom:0; z-index:60; display:flex;
  background:rgba(242,237,225,.94); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
  border-top:1px solid var(--border);
  padding-bottom:var(--tab-pad-b,20px);
  transition:transform .2s ease; }
/* Reading gets the whole screen back; the first flick upwards returns the
   bar. The class sits on <body> rather than on the bar, because renderTabBar
   replaces the bar's markup and a class on it would not survive a repaint.
   The extra pixel clears the top border, which would otherwise sit as a hair
   line along the bottom of a bar that has supposedly gone. */
body.tabs-down .tabbar{ transform:translateY(calc(100% + 1px)); }
/* 44px tall, which is the smallest a tap target should be and no larger.
   It was carrying about six spare pixels of padding on top of an icon a
   size bigger than it needed to be, which is not much on its own and is
   very obvious the moment the bar slides away and you see what it was
   covering. */
.tabbar .tab{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:1px; padding:6px 0 4px; border:0; background:none; cursor:pointer;
  color:var(--ink-muted); font-size:10px; letter-spacing:.01em; }
.tabbar .tab span{ line-height:1.15; }
.tabbar .tab.on{ color:var(--accent); font-weight:600; }
.tabbar .tab:active{ background:rgba(0,0,0,.04); }

/* ---- calendar --------------------------------------------------------- */
.cal-head{ display:grid; grid-template-columns:repeat(7,1fr); gap:3px; margin-bottom:3px; }
.cal-head div{ text-align:center; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em;
  color:var(--ink-muted); padding:2px 0; }
/* Exactly three rows tall, so the fourth week is the thing you scroll to
   rather than something half-showing. */
.cal-scroll{ height:calc(3 * 92px + 2 * 3px); overflow-y:auto; overscroll-behavior:contain;
  border:1px solid var(--border-light); border-radius:12px; padding:3px; background:var(--card-alt); }
.cal-grid{ display:grid; grid-template-columns:repeat(7,1fr); gap:3px; }
.cal-cell{ height:92px; background:#fff; border:1px solid var(--border-light); border-radius:8px;
  padding:3px; overflow:hidden; cursor:pointer; display:flex; flex-direction:column; gap:2px; text-align:left; }
.cal-cell:active{ background:var(--card-alt); }
.cal-cell.cal-dim{ background:#f7f4ed; color:var(--ink-muted); }
.cal-cell.cal-today{ border-color:var(--accent); box-shadow:inset 0 0 0 1px var(--accent); }
.cal-num{ font-size:11.5px; font-weight:700; color:var(--ink-muted); display:flex; justify-content:space-between; gap:2px; }
.cal-today .cal-num{ color:var(--accent); }
.cal-mon{ font-size:9.5px; font-weight:700; text-transform:uppercase; color:var(--accent); }
.cal-chips{ display:flex; flex-direction:column; gap:2px; overflow:hidden; }
.cal-chip{ display:block; width:100%; text-align:left; font-size:9.5px; line-height:1.25; padding:2px 3px;
  border:0; border-radius:4px; background:#fbf0ef; color:var(--accent); cursor:pointer;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cal-chip.cal-chip-orphan{ background:var(--border-light); color:var(--ink-muted); }
.cal-chip.cal-chip-meal{ background:var(--meal-soft); color:var(--meal-dark); }
.cal-more{ font-size:9px; color:var(--ink-muted); padding-left:3px; }
.cal-tools{ display:flex; align-items:center; gap:8px; margin:10px 0 0; }

/* ---- community meals ----
   One tile per meal, a week wide, because a shared meal is not a square on a
   grid: it is a guest list, a menu and a sign-up sheet, and none of those
   fit in 92 pixels. So it sits below the calendar at full width and the grid
   above only carries the blue chip for whatever you personally agreed to
   bring. */
.meal-add{ width:100%; display:flex; align-items:center; justify-content:center; gap:6px; margin:2px 0 12px; }
/* Where a recipe came from, under the steps it produced. The URL wraps at any
   character because a recipe URL is one long unbroken token more often than
   not, and left alone it would push the column wider than the phone. */
.source-credit{ margin-top:16px; padding-top:12px; border-top:1px solid var(--border-light); }
.source-credit .small-label{ margin-bottom:4px; }
.source-credit a{ font-size:12.5px; color:var(--ink-muted); word-break:break-all; }
.meal-tile{ border:1px solid var(--meal-line); border-radius:12px; background:var(--card);
  margin-bottom:10px; overflow:hidden; }
.meal-tile.meal-mine{ border-color:var(--meal); }
.meal-tile.meal-focus{ box-shadow:0 0 0 2px var(--meal); }
.meal-head{ background:var(--meal-soft); padding:10px 12px; border-bottom:1px solid var(--meal-line); }
.meal-title{ font-size:15.5px; font-weight:700; color:var(--meal-dark); margin:0 0 2px;
  display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
.meal-when{ font-size:12.5px; color:var(--meal-dark); opacity:.85; }
.meal-host{ font-size:12px; color:var(--ink-muted); margin-top:2px; }
.meal-body{ padding:10px 12px; }
.meal-sec{ font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-muted);
  margin:0 0 5px; }
.meal-sec + .meal-sec{ margin-top:12px; }
.meal-guests{ display:flex; flex-wrap:wrap; gap:5px; margin:0 0 12px; }
.meal-guest{ display:inline-flex; align-items:center; gap:4px; font-size:12.5px;
  padding:3px 8px; border-radius:20px; background:var(--border-light); color:var(--ink); }
.meal-guest.on{ background:var(--meal-soft); color:var(--meal-dark); }
.meal-guest.waiting{ color:var(--ink-muted); font-style:italic; }
.meal-guest button{ border:0; background:none; padding:0; margin-left:2px; cursor:pointer;
  color:var(--ink-muted); display:inline-flex; }
.meal-dishes{ list-style:none; margin:0 0 12px; padding:0; }
/* One dish, one row. The name gives way before the row does - a long title
   ellipses rather than pushing the cook's name onto a second line, because
   who is bringing it is the part you are scanning the list for. */
.meal-dish{ display:flex; align-items:center; flex-wrap:nowrap; gap:8px; padding:6px 0;
  border-bottom:1px solid var(--border-light); font-size:14px; }
.meal-dish:last-child{ border-bottom:0; }
.meal-dish .what{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* Name and remove sit in the same box so the x is beside the name it belongs
   to rather than wrapping underneath it. */
.meal-dish-who{ margin-left:auto; flex-shrink:0; display:inline-flex; align-items:center; gap:2px;
  font-size:12px; color:var(--ink-muted); }
.meal-dish-who .icon-btn{ flex-shrink:0; }
.meal-dish .lots{ color:var(--gold); font-size:11.5px; flex-shrink:0; }
.meal-none{ font-size:13px; color:var(--ink-muted); margin:0 0 12px; }
.meal-actions{ display:flex; flex-wrap:wrap; gap:8px; }
/* An invitation is a question and two answers, stacked: the asking on its own
   line, then Accept and Decline side by side underneath. Side by side with
   the question they were being squeezed to a third of the width each. */
.meal-invite{ display:flex; flex-direction:column; align-items:stretch; gap:9px;
  background:var(--meal-soft); border:1px solid var(--meal-line); border-radius:10px;
  padding:9px 12px; margin:0 0 12px; font-size:13px; color:var(--meal-dark); }
.meal-invite .grow{ flex:1; min-width:0; }
.meal-invite-acts{ display:flex; align-items:center; gap:8px; }
.meal-invite-acts .btn{ flex:1; justify-content:center; }
/* The two lines a meal can carry beyond its name. Both are optional, so
   neither leaves a gap when it is not there. */
.meal-note{ font-size:12.5px; color:var(--meal-dark); opacity:.9; margin:4px 0 0; }
.meal-where{ display:flex; align-items:flex-start; gap:5px; font-size:12.5px;
  color:var(--meal-dark); opacity:.9; margin-top:3px; }
.meal-where svg{ flex-shrink:0; margin-top:1px; }
.btn-meal{ background:var(--meal); border-color:var(--meal); color:#fff; }
.btn-meal:active{ background:var(--meal-dark); }
/* Something already eaten is a record, not a plan. It keeps one line until
   asked for more. */
.meal-past{ border-color:var(--border-light); }
.meal-past-head{ display:flex; align-items:center; gap:8px; width:100%; text-align:left;
  font:inherit; font-size:13.5px; color:var(--ink-muted); background:none; border:0;
  padding:9px 12px; cursor:pointer; }
.meal-past-head .when{ margin-left:auto; font-size:12px; flex-shrink:0; }
.meal-past-head svg{ flex-shrink:0; transition:transform .15s ease; }
.meal-past-head[aria-expanded="true"] svg{ transform:rotate(180deg); }
/* Recipe, how much, add, drop - one row. It used to wrap onto three on a
   phone, which put the control that abandons the pick a long way from the
   pick it abandons. The name is the only part that gives, so the numbers and
   the two buttons stay where the thumb last found them. */
.meal-dish-pick{ display:flex; align-items:center; gap:6px; flex-wrap:nowrap;
  background:var(--meal-soft); border:1px solid var(--meal-line); border-radius:10px;
  padding:9px 10px; margin-top:6px; font-size:13.5px; }
.meal-dish-pick .name{ flex:1; min-width:0; font-weight:600; color:var(--meal-dark);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.meal-dish-pick input{ width:58px; flex-shrink:0; text-align:center; padding-left:4px; padding-right:4px; }
.meal-dish-pick .unit{ font-size:12px; color:var(--ink-muted); flex-shrink:0;
  max-width:74px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.meal-dish-pick .btn{ flex-shrink:0; padding-left:9px; padding-right:9px; }
.meal-dup{ background:#fdf6e6; border:1px solid #e8d5a0; border-radius:9px; padding:8px 10px;
  font-size:12.5px; color:#7a5a12; margin-top:6px; }
.sched-banner{ display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  background:#fbf0ef; border:1px solid #e3b3ae; border-radius:10px; padding:9px 12px;
  font-size:13px; color:var(--accent-dark); margin-bottom:12px; }
.sched-banner b{ font-weight:600; }

/* ---- grocery ---------------------------------------------------------- */
/* Two date fields side by side on a narrow phone.
   -webkit-appearance is the fix that actually matters. iOS draws a date
   input as a native control sized to its own content, and it ignores
   width:100% while it is doing so - so the second field kept its natural
   width, ran past the right edge and sat on top of the first. Clearing the
   appearance hands sizing back to CSS. Grid rather than flex for the same
   reason twice over: minmax(0,1fr) states the halves outright instead of
   asking two intrinsically-wide controls to agree to shrink. */
.groc-range{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  gap:8px; align-items:end; margin-bottom:12px; }
.groc-range .field{ min-width:0; margin:0; }
.groc-range .field label{ display:block; text-align:center; }
/* Date and time are styled as one control, not two. Left to itself iOS gives
   each of them its own intrinsic height, and the taller of the pair drags its
   label off the line the other one's label is sitting on. */
.groc-range .field input[type=date],
.groc-range .field input[type=time]{
  -webkit-appearance:none; appearance:none;
  width:100%; min-width:0; max-width:100%; box-sizing:border-box;
  height:42px; line-height:normal;
  padding-left:4px; padding-right:4px; font-size:14px; text-align:center; }
.groc-range .btn{ grid-column:1 / -1; justify-content:center; }
.groc-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.groc-entry{ display:flex; align-items:center; gap:10px; background:#fff;
  border:1px solid var(--border-light); border-radius:11px; padding:12px 13px; }
.groc-entry-main{ flex:1; min-width:0; text-align:left; border:0; background:none; cursor:pointer; padding:0; }
.groc-entry-label{ font-size:14px; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.groc-entry-sub{ font-size:12px; color:var(--ink-muted); margin-top:2px; }
/* The plus at the end of a result used to be a bare span, so the one part of
   the row that looks like the button was the one part that did nothing. */
.groc-entry-plus{ flex-shrink:0; border:0; background:none; padding:6px; margin:-6px -4px -6px 0;
  cursor:pointer; color:var(--ink-muted); display:flex; align-items:center; }
.groc-entry-plus:active{ color:var(--meal); }
/* One shopping line, collapsed: tick, name, quantity, grip - one line, no
   card. The old row stacked name over source over a quantity input and came
   to ~93px, which on a small phone is four items a screen. Name and quantity
   share a line, the source moves into the expanded editor, and the cards
   become one bordered list with hairline rules, which lands at ~44px. */
.groc-lines{ list-style:none; margin:0; padding:0; background:#fff;
  border:1px solid var(--border-light); border-radius:12px; overflow:hidden; }
.groc-row{ position:relative; overflow:hidden;
  border-bottom:1px solid var(--border-light); }
.groc-row:last-child{ border-bottom:0; }
/* The row's visible content rides on this, so it can slide left off the
   button parked underneath. touch-action:pan-y is the whole contract with
   iOS: the vertical gesture stays the scroller's, and only once the finger
   has proved it is going sideways does the row claim it. Anything else here
   and either the list stops scrolling or the swipe never starts. */
.groc-slide{ display:flex; align-items:center; gap:8px; padding:0 4px 0 9px;
  min-height:44px; background:#fff; touch-action:pan-y;
  transition:transform .18s ease; will-change:transform; }
.groc-row.swiping .groc-slide{ transition:none; }
.groc-row.swiped .groc-slide{ transform:translateX(-96px); }
.groc-swipe-back{ position:absolute; top:0; right:0; bottom:0; width:96px;
  display:flex; align-items:stretch; }
.groc-swipe-back button{ flex:1; border:0; cursor:pointer; color:#fff;
  font-size:12.5px; font-weight:600; display:flex; align-items:center;
  justify-content:center; gap:5px; background:var(--accent); padding:0; }
.groc-swipe-back button.put-back{ background:var(--green); }
.groc-row.groc-done .groc-name{ text-decoration:line-through; color:var(--ink-muted); }
.groc-row.groc-dragging .groc-slide{ opacity:.65; background:var(--card-alt); }
.groc-row.merge-src .groc-slide{ background:#fbf0ef; }
.groc-row.merge-target .groc-slide{ cursor:pointer; background:#fdfaf7; }
.groc-row.merge-target .groc-name{ color:var(--accent-dark); }
.groc-tick{ flex-shrink:0; width:22px; height:22px; border-radius:6px;
  border:1.5px solid var(--border); background:#fff; color:#fff; cursor:pointer;
  display:flex; align-items:center; justify-content:center; padding:0; }
.groc-tick.on{ background:var(--green); border-color:var(--green); }
/* The name is the wide tap target and it opens the editor. Truncated rather
   than wrapped: a wrapping name is the thing that makes row heights uneven,
   and the full text is one tap away in the editor. */
.groc-name{ flex:1; min-width:0; font-size:14.5px; line-height:1.25; text-align:left;
  border:0; background:none; padding:6px 0; color:inherit; cursor:pointer;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.groc-name:active{ color:var(--accent); }
/* Both units in one chip. Tapping it opens the same editor the name does,
   with the quantity focused instead. */
.groc-qty-chip{ flex-shrink:0; max-width:44%; font-size:12px; color:var(--ink-muted);
  background:var(--card-alt); border:1px solid var(--border-light); border-radius:7px;
  padding:3px 7px; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.groc-qty-chip:active{ border-color:var(--accent); color:var(--accent); }
/* touch-action is the whole trick on iOS: without it the first finger-move
   is claimed by the scroller and the row never gets a pointermove. */
.groc-grip{ flex-shrink:0; color:var(--border); cursor:grab; padding:8px 3px;
  touch-action:none; -webkit-user-select:none; user-select:none; }

/* The editor. One row open at a time, so the list never grows by more than
   this much and the thing you tapped stays where you left it. */
.groc-edit{ padding:2px 9px 11px; background:var(--card-alt);
  border-bottom:1px solid var(--border-light); }
.groc-edit:last-child{ border-bottom:0; }
.groc-edit input.groc-name-input{ width:100%; font-size:14.5px; padding:7px 9px;
  border:1px solid var(--border); border-radius:8px; background:#fff; }
.groc-from{ font-size:11.5px; color:var(--ink-muted); margin:6px 0 0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.groc-qty{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:8px; }
.groc-qty input{ width:78px; padding:5px 7px; font-size:13px; border-radius:7px;
  border:1px solid var(--border); background:#fff; text-align:right; }
.groc-unit{ font-size:12px; color:var(--ink-muted); }
.groc-plus{ font-size:12px; color:var(--ink-muted); padding:0 1px; }
.groc-edit-acts{ display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
.groc-merge-hint{ background:#fbf0ef; border:1px solid #e3b3ae; border-radius:10px;
  padding:9px 12px; font-size:13px; color:var(--accent-dark); margin-bottom:10px;
  display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

/* A line you have said you do not need. Still there, still recoverable,
   plainly not part of the shop any more. */
.groc-row.groc-gone .groc-slide{ background:#f7f4ed; }
.groc-row.groc-gone .groc-name{ color:var(--ink-muted); }
.groc-row.groc-gone .groc-qty-chip{ color:var(--ink-muted); background:transparent; }
.groc-sep{ background:var(--card-alt); border-bottom:1px solid var(--border-light); }
.groc-sep:last-child{ border-bottom:0; }
/* Collapsed by default. Everything under these headings is either already in
   the cart or deliberately not being bought, so neither is worth the height
   while you are still working through the list. */
.groc-sec{ display:flex; align-items:center; gap:7px; width:100%; padding:9px 9px;
  border:0; background:none; cursor:pointer; text-align:left;
  font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-muted); }
.groc-sec .groc-sec-n{ font-weight:700; color:var(--ink); }
.groc-sec svg{ flex-shrink:0; transition:transform .15s ease; }
.groc-sec.open svg{ transform:rotate(180deg); }
.groc-sec::after{ content:""; flex:1; }
.groc-sec:active{ color:var(--accent); }
.groc-tidy{ display:flex; align-items:center; justify-content:center; gap:6px;
  width:100%; margin-bottom:10px; }
/* The confirm list. Nothing folds without being seen first: a scan that is
   right nine times in ten and silent about the tenth is worse than no scan,
   because the tenth is a thing you then do not buy. */
.excl-add{ display:flex; gap:8px; align-items:center; margin-bottom:10px; }
.excl-add input{ flex:1; min-width:0; padding:8px 10px; font-size:14px;
  border:1px solid var(--border); border-radius:8px; }
.excl-add .btn{ flex-shrink:0; }
.excl-list{ list-style:none; margin:0 0 4px; padding:0; max-height:38vh;
  max-height:calc(var(--vv-height,100dvh) * .38); overflow-y:auto; overscroll-behavior:contain; }
.excl-row{ display:flex; align-items:center; gap:8px; padding:8px 2px;
  border-bottom:1px solid var(--border-light); font-size:14px; }
.excl-row span{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.excl-row:last-child{ border-bottom:0; }
.excl-empty{ padding:10px 2px; font-size:13px; color:var(--ink-muted); }
.merge-rows{ display:flex; flex-direction:column; gap:2px; max-height:46vh;
  max-height:calc(var(--vv-height,100dvh) * .46); overflow-y:auto; overscroll-behavior:contain;
  margin:0 0 4px; }
.merge-row{ display:flex; align-items:flex-start; gap:10px; padding:9px 4px;
  border-bottom:1px solid var(--border-light); cursor:pointer; }
.merge-row:last-child{ border-bottom:0; }
.merge-row input{ margin-top:2px; flex-shrink:0; width:18px; height:18px; accent-color:var(--accent); }
.merge-body{ flex:1; min-width:0; }
.merge-from{ display:block; font-size:13px; color:var(--ink-muted); }
.merge-into{ display:flex; align-items:center; gap:5px; font-size:14px; margin-top:3px; }
.merge-into svg{ color:var(--accent); flex-shrink:0; }
.groc-add{ width:100%; margin-top:10px; display:flex; align-items:center; justify-content:center; gap:6px; }
/* The name of an open list is the name of the list, and tapping a title to
   change it is the thing everyone tries first. */
.title-edit{ display:flex; align-items:flex-start; gap:8px; width:100%; margin:0 0 4px;
  padding:0; border:0; background:none; color:inherit; text-align:left; cursor:pointer; }
.title-edit svg{ color:var(--border); flex-shrink:0; margin-top:7px; }
.title-edit:active h1, .title-edit:active svg{ color:var(--accent); }
.groc-counts{ display:flex; gap:10px; flex-wrap:wrap; font-size:12.5px; color:var(--ink-muted); margin:0 0 10px; }
/* The list header, in one line. It used to be a back link, a two-line
   date-stamped title, a counts line and a five-line paragraph of
   instructions - about 420px before the first item, on a phone that has
   maybe 550 to give. All four are still here; three of them are now a
   date, a count and an ⓘ.
   It scrolls away with the list rather than staying pinned: the list is the
   thing you are reading, and the bar has nothing on it you need mid-aisle.
   The negative margins pull it out to the full width so its rule meets both
   edges, and the padding puts the contents back where .wrap had them. */
.groc-bar{ display:flex; align-items:center; gap:6px;
  margin:0 -16px 10px; padding:8px 12px;
  background:rgba(242,237,225,.94); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
  border-bottom:1px solid var(--border-light); }
.groc-bar-back{ flex-shrink:0; display:flex; align-items:center; border:0; background:none;
  color:var(--ink-muted); cursor:pointer; padding:4px 2px; }
.groc-bar-back:active{ color:var(--accent); }
.groc-bar-title{ flex:1; min-width:0; display:flex; align-items:baseline; gap:8px;
  border:0; background:none; cursor:pointer; padding:4px 0; text-align:left; color:inherit; }
.groc-bar-title .lbl{ font-size:15px; font-weight:600; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.groc-bar-title .cnt{ flex-shrink:0; font-size:12.5px; color:var(--ink-muted); }
.groc-bar-title:active .lbl{ color:var(--accent); }

/* One week visible, the rest a scroll away. Same idea as .cal-scroll, one
   row instead of three. */
.sched-strip{ height:74px; overflow-y:auto; overscroll-behavior:contain; margin-bottom:12px;
  border:1px solid var(--border-light); border-radius:10px; padding:3px; background:var(--card-alt); }
.sched-grid{ display:grid; grid-template-columns:repeat(7,1fr); gap:3px; }
.sched-cell{ height:68px; background:#fff; border:1px solid var(--border-light); border-radius:7px;
  padding:3px 2px; display:flex; flex-direction:column; align-items:center; gap:1px;
  cursor:pointer; overflow:hidden; font:inherit; }
.sched-cell.sched-today{ border-color:var(--accent); }
.sched-cell.on{ background:#fbf0ef; border-color:var(--accent); box-shadow:inset 0 0 0 1px var(--accent); }
.sched-dow{ font-size:9px; text-transform:uppercase; letter-spacing:.04em; color:var(--ink-muted); }
.sched-num{ font-size:12.5px; font-weight:700; line-height:1; }
.sched-cell.on .sched-num{ color:var(--accent); }
.sched-chips{ display:flex; flex-direction:column; gap:1px; width:100%; overflow:hidden; }
.sched-chip{ display:block; font-size:8.5px; line-height:1.3; padding:0 2px; border-radius:3px;
  background:#fbf0ef; color:var(--accent); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* toast / loading */
body.tabs-down .toast{ bottom:calc(16px + var(--tab-pad-b,20px)); }
.toast{ position:fixed; bottom:calc(56px + var(--tab-pad-b,20px)); transition:bottom .2s ease; left:50%; transform:translateX(-50%); background:var(--ink); color:#fff; padding:9px 16px; border-radius:9px; font-size:13.5px; z-index:100; max-width:90vw; text-align:center; }
.loading{ display:flex; align-items:center; justify-content:center; height:75vh; color:var(--ink-muted); font-size:14.5px; }

::-webkit-scrollbar{ width:8px; height:8px; }
::-webkit-scrollbar-thumb{ background:var(--border); border-radius:8px; }

.search-wrap { display:flex; gap:8px; align-items:center; }
.search-wrap input { flex:1; }
/* The field is its own positioning context so the clear button can sit
   inside the input's right edge rather than the row's. */
.search-field{ position:relative; flex:1; display:flex; align-items:center; }
.search-field input{ padding-right:40px; }
.search-clear{ position:absolute; right:7px; top:50%; transform:translateY(-50%);
  display:none; align-items:center; justify-content:center; width:26px; height:26px; padding:0;
  border:0; border-radius:50%; background:var(--border-light); color:var(--ink-muted); cursor:pointer; }
.search-clear.on{ display:flex; }
.search-clear:active{ background:var(--border); }
.search-filter { flex-shrink:0; display:flex; align-items:center; gap:5px; }
.search-filter.on { background:var(--accent); color:#fff; border-color:var(--accent); }
.fcount { display:inline-block; flex-shrink:0; min-width:17px; padding:0 5px; border-radius:9px; background:var(--accent);
  color:#fff; font-size:11px; line-height:17px; text-align:center; margin-left:6px; }
/* Still occupies its slot, so a row is the same height counted or not. */
.fcount.zero { visibility:hidden; }
.search-filter.on .fcount { background:#fff; color:var(--accent); }
.chip-clear { border-style:dashed; }

/* A code and the thing it says, side by side. Stacks on a narrow screen so
   the code never shrinks below scanning size. */
.qr-side{ display:flex; gap:14px; align-items:center; background:var(--card);
  border:1px solid var(--border-light); border-radius:12px; padding:14px; }
.qr-holder{ flex-shrink:0; line-height:0; background:#fff; border-radius:6px; }
.qr-side-text{ min-width:0; flex:1; }
.qr-side-text .code-box{ font-size:12.5px; letter-spacing:0; padding:9px; margin-bottom:8px; text-align:left; }
@media (max-width: 430px){ .qr-side{ flex-direction:column; align-items:stretch; } .qr-holder{ align-self:center; } }
/* The share row on a recipe: link on the left, code on the right. A grid
   rather than the flex .qr-side above, because this pair must stay two
   columns at every width - the whole point is being able to see the code and
   the button that copies the same link at the same time. The left column
   takes what is left after the code has been given its fixed size, and the
   URL breaks anywhere because a recipe link is one long unbroken token. */
.qr-share{ display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px;
  align-items:start; background:var(--card); border:1px solid var(--border-light);
  border-radius:12px; padding:12px; }
.qr-share .code-box{ font-size:11px; letter-spacing:0; padding:7px 8px; margin:0 0 8px;
  text-align:left; word-break:break-all; line-height:1.35; }
.qr-share .qr-holder{ line-height:0; background:#fff; border-radius:6px; }
.qr-share-note{ margin:9px 0 0; }
/* The three tiers, as rows you pick rather than a switch you flip. A switch
   only ever expressed two of them. */
.vis-rows{ display:flex; flex-direction:column; gap:8px; }
.vis-row{ text-align:left; border:1px solid var(--border-light); background:var(--card);
  border-radius:10px; padding:10px 12px; cursor:pointer; width:100%; }
.vis-row.on{ border-color:var(--accent); box-shadow:inset 0 0 0 1px var(--accent); }
.vis-row-head{ display:flex; align-items:center; gap:7px; font-weight:600; font-size:14px; color:var(--ink); }
.vis-row-sub{ font-size:12px; color:var(--ink-muted); margin-top:3px; line-height:1.4; }
.pill-select{ background:var(--meal-soft); border-color:var(--meal-line); color:var(--meal-dark); }
/* The author's name, when tapping it would do something. Reads as the same
   badge either way; only the pointer and the small plus say it is live. */
.owner-badge-btn{ cursor:pointer; border:1px solid var(--border-light); }
.owner-badge-btn svg{ vertical-align:-1px; margin-left:2px; }
/* The offer of an account, shown to somebody reading a link with none. */
.link-join{ background:var(--card); border:1px solid var(--border-light);
  border-radius:12px; padding:12px; margin:12px 0; }

/* tabs */
.tabs{ display:flex; gap:6px; border-bottom:1px solid var(--border); margin:4px 0 18px; }
.tabs button{ position:relative; background:none; border:0; padding:10px 4px; margin-right:14px;
  font-size:14.5px; color:var(--ink-muted); cursor:pointer; display:inline-flex; align-items:center; gap:7px; }
.tabs button.active{ color:var(--ink); font-weight:600; box-shadow:inset 0 -2px 0 var(--accent); }
.tab-count{ min-width:18px; padding:0 5px; border-radius:9px; background:var(--accent); color:#fff;
  font-size:10.5px; line-height:18px; text-align:center; }

/* notifications */
.notif-tools{ display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
.notif{ display:flex; gap:11px; align-items:flex-start; background:var(--card);
  border:1px solid var(--border-light); border-left:3px solid var(--accent);
  border-radius:10px; padding:12px 13px; margin-bottom:9px; cursor:pointer;
  -webkit-tap-highlight-color:transparent; }
.notif:active{ background:var(--card-alt); }
.notif.read{ background:var(--card-alt); border-left-color:var(--border); }
.notif-dot{ width:9px; height:9px; border-radius:50%; background:var(--accent); flex-shrink:0; margin-top:5px; }
.notif.read .notif-dot{ background:transparent; border:1px solid var(--border); }
.notif-body{ flex:1; min-width:0; }
.notif-line{ font-size:14px; margin:0 0 3px; }
.notif.read .notif-line{ color:var(--ink-muted); }
.notif-when{ font-size:11.5px; color:var(--ink-muted); font-variant-numeric:tabular-nums; }
.notif-acts{ display:flex; flex-direction:column; gap:6px; flex-shrink:0; }

/* The tag strip on a recipe, three rows then a scroll - the same rule the
   library's chip row follows. Both caps are the row height times three plus
   the gaps between, so "three rows" is exact rather than about right:
   .chips is 3*32 + 2*8 = 112, and a tag is 16 + 3 + 3 = 22 high, giving
   3*22 + 2*7 = 80. The line-height is pinned here for that reason - left to
   the font it drifts and the cap stops meaning three rows. */
.detail-tags{ display:flex; flex-wrap:wrap; align-content:flex-start; gap:7px;
  max-height:80px; overflow-y:auto; padding-right:2px; margin:0 0 18px; }
.detail-tags .tag{ line-height:16px; }
/* iOS draws its scroll indicator itself and only while a scroll is in
   flight, so nothing we do to the scrollbar shows up when a tree expands.
   A fade along the bottom edge is drawn by us instead: it appears the
   moment there is more list below the fold and goes as you reach the end,
   which is the thing the scrollbar was meant to tell you. The scrollbar
   rules stay for desktop, where a real one is drawn and is useful. */
.filter-scroll { position:relative; margin:4px 0 12px; }
.filter-scroll::after { content:""; position:absolute; left:0; right:0; bottom:0; height:30px;
  background:linear-gradient(to top, #fff 15%, rgba(255,255,255,0)); pointer-events:none;
  opacity:0; transition:opacity .18s ease; }
.filter-scroll.more::after { opacity:1; }
/* Capped against the same measurement the overlay uses. A dvh here was the
   second half of the bottom-bar problem: the list could claim more height
   than the card had to give, so the card scrolled instead of the list and
   the footer buttons drifted off the visible area. */
.filter-body { max-height:60vh; max-height:60dvh; max-height:calc(var(--vv-height,100dvh) * .6);
  overflow-y:auto; overscroll-behavior:contain;
  scrollbar-width:thin; scrollbar-color:rgba(34,31,28,.28) transparent; }
.filter-body::-webkit-scrollbar { width:9px; }
.filter-body::-webkit-scrollbar-track { background:transparent; }
.filter-body::-webkit-scrollbar-thumb { background:rgba(34,31,28,.28); border-radius:5px;
  border:2px solid transparent; background-clip:content-box; }
.fcat { border-bottom:1px solid rgba(0,0,0,.08); }
.fcat > summary { cursor:pointer; padding:11px 2px; font-weight:600; list-style:none; display:flex;
  align-items:center; line-height:19px; }
.fcat > summary::-webkit-details-marker { display:none; }
.fcat > summary::before { content:"+"; width:16px; opacity:.5; font-weight:400; }
.fcat[open] > summary::before { content:"−"; }
.fgrp { margin:1px 0 4px; border-left:2px solid rgba(0,0,0,.07); padding-left:9px; }
.fgrp > summary { cursor:pointer; padding:7px 2px; font-size:13.5px; font-weight:600; list-style:none;
  display:flex; align-items:center; line-height:19px; }
.fgrp > summary::-webkit-details-marker { display:none; }
.fgrp > summary::before { content:"+"; width:14px; opacity:.5; font-weight:400; }
.fgrp[open] > summary::before { content:"−"; }
.fgrp-body { padding:0 0 2px; }
.fbox-all { font-weight:600; }
.fwrap { display:flex; flex-wrap:wrap; gap:6px; padding:2px 0 6px; }
.fbox { font:inherit; font-size:13px; padding:5px 10px; border-radius:14px; cursor:pointer;
  border:1px solid rgba(0,0,0,.18); background:var(--card); color:inherit; }
.fbox.on { background:var(--accent); border-color:var(--accent); color:#fff; }
.tagchips { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:7px; min-height:22px; align-items:center; }
.tagchip { display:inline-flex; align-items:center; gap:4px; font-size:13px; padding:4px 6px 4px 10px;
  border-radius:14px; background:var(--accent); color:#fff; }
.tagchip button { background:none; border:none; color:#fff; cursor:pointer; padding:0 2px; line-height:0; }
.tag-suggest { display:flex; flex-wrap:wrap; gap:6px; margin-top:7px; }
.tag-opt { font:inherit; font-size:13px; padding:5px 10px; border-radius:14px; cursor:pointer;
  border:1px dashed rgba(0,0,0,.25); background:var(--card-alt); color:inherit; }

.adm { margin-top:14px; border-top:1px solid rgba(0,0,0,.1); padding-top:6px; }
.adm > summary { cursor:pointer; font-size:13px; opacity:.65; list-style:none; padding:6px 0; }
.adm > summary::-webkit-details-marker { display:none; }
.adm-out { white-space:pre-wrap; font-family:ui-monospace,Menlo,monospace; font-size:11.5px;
  background:var(--card-alt); border-radius:8px; padding:10px; margin-top:9px; max-height:34vh;
  overflow:auto; line-height:1.45; }

.mark-row{ display:inline-flex; gap:6px; margin-left:auto; }
.mark{ border:1px solid var(--border-light); background:#fff; color:var(--ink-muted); border-radius:8px;
  padding:5px 7px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; line-height:0; }
.mark span{ font-size:12.5px; line-height:1.15; }
.mark-star.on{ color:var(--gold); border-color:var(--gold); background:rgba(200,133,15,.14); }
.mark-later.on{ color:var(--green); border-color:var(--green); background:rgba(47,107,69,.14); }
.mark-pin.on{ color:var(--accent); border-color:var(--accent); background:rgba(143,45,36,.14); }
/* No on/off to it - the calendar button opens a frame rather than setting a
   flag - so it only ever shows the pressed state its neighbours share. */
.mark-cal:active{ color:var(--accent); border-color:var(--accent); background:rgba(143,45,36,.14); }
/* Shown rather than hidden to somebody reading a link without an account:
   greying them out says what a cookbook would let them do here, where
   leaving them out says nothing at all. Pointer events go off as well as the
   disabled attribute so a tap does not even flash the pressed state. */
.mark[disabled]{ opacity:.42; cursor:default; pointer-events:none; }
.detail-marks{ display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 4px; }
.owner-pick{ text-align:left; }
.pick-list{ max-height:52vh; overflow-y:auto; margin-top:10px; }
/* The meal sheets carry a guest list on top of everything else they ask for,
   so theirs is pegged at three rows and scrolls. Whose recipes keeps the full
   half-screen: a picker that is the whole sheet can afford the room. Three
   rows of 44px plus the 7px gaps between them. */
.pick-list-3{ max-height:145px; }
.pick-row{ display:block; width:100%; text-align:left; font:inherit; font-size:14.5px; padding:10px 11px;
  border:1px solid var(--border-light); background:var(--card); border-radius:9px; margin-bottom:6px;
  cursor:pointer; color:inherit; }
.pick-row.on{ border-color:var(--accent); background:rgba(143,45,36,.09); font-weight:600; }
.share-row{ display:flex; align-items:center; gap:8px; padding:7px 0; }
</style>
<script>
/* Which of the two layouts to use, decided before anything is drawn so the
   page never renders one way and then the other. An installed app keeps the
   shell where #app is the scroller; a browser tab hands scrolling back to
   the document so iOS will fold its toolbars away. display-mode is checked
   for fullscreen as well because the manifest asks for it first, and
   navigator.standalone covers older iOS, which answers neither query. */
(function () {
  /* Set false to go back to app-shell scrolling in the installed app.
     The shell - html, body and #app all height:100% with overflow hidden -
     is a viewport-sized fixed container, which is the exact shape iOS 26
     miscalculates the bottom of. It leaves phantom space where the Safari
     toolbar would be even though there is no toolbar, and no stylesheet
     touches it because it is outside the layout viewport rather than inside
     it: not the tab bar, not the clearance, not theme-color, not the canvas.
     Rotating the device makes it recompute, which is why landscape cleared
     it. Apple fixed this in Safari 26.1; the standing workaround before that
     was to stop handing the viewport a fixed full-height container, which is
     what doc-scroll already does. So the tab gets it and the installed app
     gets it too, and the bar has nothing left to hang on. */
  var FORCE_DOC_SCROLL = true;
  try {
    if (FORCE_DOC_SCROLL) { document.documentElement.classList.add("doc-scroll"); return; }
    var mm = window.matchMedia;
    var installed =
      (mm && (mm("(display-mode: standalone)").matches ||
              mm("(display-mode: fullscreen)").matches ||
              mm("(display-mode: minimal-ui)").matches)) ||
      window.navigator.standalone === true;
    if (!installed) document.documentElement.classList.add("doc-scroll");
  } catch (e) {}
})();
</script>
</head>
<body>
<div id="app"></div>
<div class="sb-scrim"></div>
<div id="tabbar-root"></div>
<div id="modal-root"></div>
<div id="toast-root"></div>


<script type="text/plain" id="import-prompt-template">You are converting one recipe into a single-line JSON object for a personal recipe app. {{SOURCE}} Then output ONE single-line JSON object and nothing else — no markdown code fences, no explanation before or after, no pretty-printing or indentation.

Follow this schema exactly:

{
  "title": string,
  "description": string,       // 1-2 sentences
  "source": { "url": string, "site": string } | null,
  "tags": string[],            // only tags from the list at the end of this prompt
  "servings": { "base": number, "unit": string },
  "macrosPerServing": {
    "calories": number, "proteinG": number, "fatG": number, "carbsG": number,
    "source": "site" | "estimated"
  },
  "ingredients": [
    {
      "name": string,
      "metricValue": number, "metricUnit": string,
      "customaryValue": number, "customaryUnit": string,
      "notes": string
    }
  ],
  "steps": [
    { "text": string, "timerMinutes": number | null }
  ],
  "notes": ""
}

Rules:
1. Title. Use the plain, descriptive name of the dish — "Chicken Piccata", "Brown Butter Chocolate Chip Cookies". A dish name is not anybody's property and does not need rewording. A distinctive or branded headline is: "The Best Damn Chewy Brownies You Will Ever Make" becomes "Chewy Brownies". Never carry a site's name, a byline, or a slogan into the title.
2. Nutrition first, then estimate. Check the recipe page itself for a nutrition/macros section first. If it is there, use those numbers and set macrosPerServing.source to "site". Only calculate your own estimate from the ingredient list if the source has nothing, and in that case set source to "estimated".
3. Always give both units — convert to get whichever one the source is missing. Round sensibly (grams to whole numbers, cups to the nearest quarter).
4. Countable ingredients (eggs, onions, cloves of garlic) use "each" as the unit for both value fields, with the count as the value.
5. Ingredient names are the shopping name of the thing, in Title Case — every word capitalized: "Extra Virgin Olive Oil", "All-Purpose Flour", "Unsalted Butter", "Kosher Salt". This is what the shopping list groups on, so the same thing must come out with the same name every time.
6. Use the phrasing a shop uses, not the shorthand a recipe uses. "Extra Virgin Olive Oil" rather than "Olive Oil" where that is what is meant. "Scallions" rather than "green part of scallions". Say the full, specific thing you would look for on a shelf.
7. Everything about the state or preparation of an ingredient belongs in its notes, never in its name. That covers descriptive words (all-purpose, chopped, minced, diced, finely grated, thinly sliced, room temperature) and temporal ones (melted, warm, softened, chilled, divided). "1 cup butter, melted" is name "Butter", notes "melted". "2 cloves garlic, minced" is name "Garlic", notes "minced". The exception is where the word is part of what you buy rather than what you do to it: All-Purpose Flour and Smoked Paprika are shelf names and stay whole.
8. Where the ingredient offers a choice, the name is the primary thing and the alternative goes in the notes. "milk or non-dairy milk" is name "Milk", notes "or non-dairy milk". "butter or margarine" is name "Butter", notes "or margarine". Never put "or" in an ingredient name.
9. Split the method into genuinely separate steps, not one paragraph. Include timerMinutes whenever a step names a cook/rest/chill time; otherwise null.
10. Tags come from the fixed list at the end of this prompt. Copy each one exactly as written there, capitalization included. Do not invent a tag, do not reword one, and leave out anything that is not on the list. The words before a colon are the category path, not tags; the words after the colon are the tags.
11. Be generous. Include every tag that genuinely applies: meal types, region and flavor, effort, diet, each significant ingredient, occasion or season, and every cooking method and piece of equipment involved. Twenty or more tags is normal and welcome. They exist only to make the recipe easy to find again, so more is better.
12. Where a dish suits more than one answer, give every one. A hash eaten at breakfast and at dinner gets Breakfast and Dinner both. A stew that is a main and a soup gets both.
13. Only tag what is actually true of the recipe. A wrong tag is worse than a missing one.
14. Do not add any other fields. No id, no cookLog, no dates.
15. Output must be valid JSON on one line.

TAG LIST - the only tags you may use:
{{TAG_LIST}}

{{TAIL}}
</script>

<script>
"use strict";

/* ====================================================================== */
/* Icons                                                                   */
/* ====================================================================== */
const ICONS = {
  search: '<circle cx="10" cy="10" r="6"/><line x1="20" y1="20" x2="14.5" y2="14.5"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  x: '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',
  chevronLeft: '<polyline points="15 6 9 12 15 18"/>',
  pin: '<path d="M9 3h6l-1 6 4 4v2H6v-2l4-4z"/><line x1="12" y1="15" x2="12" y2="21"/>',
  /* A place on a map, which is a different idea from Pin above - that one is
     a pushpin and means a live reference to somebody else's recipe. Using it
     for a meal's address would have overloaded the one word the app already
     spends on something else. */
  mapPin: '<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  camera: '<path d="M3 8h4l2-2h6l2 2h4v11H3z"/><circle cx="12" cy="13" r="3.4"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  sliders: '<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.5"/><circle cx="15" cy="16" r="2.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none"/>',
  chevronUp: '<polyline points="6 15 12 9 18 15"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  upload: '<path d="M12 3v12"/><polyline points="7 8 12 3 17 8"/><path d="M4 17v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M4 17v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  pencil: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/><path d="M14.5 5.5l3 3"/>',
  trash: '<polyline points="4 7 20 7"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4h6v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
  check: '<polyline points="5 13 10 18 19 7"/>',
  alert: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12.5"/><circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none"/>',
  book: '<path d="M3 5.5c3-1.2 6-1.2 9 .5v13c-3-1.7-6-1.7-9-.5z"/><path d="M21 5.5c-3-1.2-6-1.2-9 .5v13c3-1.7 6-1.7 9-.5z"/>',
  link: '<path d="M9.5 14.5l5-5"/><path d="M12.5 5.5l1-1a3.5 3.5 0 0 1 5 5l-1 1"/><path d="M11.5 18.5l-1 1a3.5 3.5 0 0 1-5-5l1-1"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  sync: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  star: '<polygon points="12 2 15 9 22 9 16.5 13.5 18.5 21 12 17 5.5 21 7.5 13.5 2 9 9 9"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2a3.4 3.4 0 0 1 0 6.6"/><path d="M17.5 14.8c2.1.6 3.5 2.4 3.5 5.2"/>',
  userPlus: '<circle cx="10" cy="8" r="3.4"/><path d="M3.5 20c0-3.3 2.9-5.5 6.5-5.5 1.4 0 2.7.3 3.7.9"/><line x1="18" y1="13" x2="18" y2="21"/><line x1="14" y1="17" x2="22" y2="17"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/>',
  logout: '<path d="M14 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8"/><polyline points="16 8 20 12 16 16"/><line x1="20" y1="12" x2="10" y2="12"/>',
  merge: '<path d="M7 21V9a5 5 0 0 1 5-5h6"/><polyline points="15 1 19 4 15 7"/><path d="M17 21v-6"/>',
  chain: '<path d="M10 13.5a4 4 0 0 0 5.7.4l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.6 1.6"/><path d="M14 10.5a4 4 0 0 0-5.7-.4l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.6-1.6"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9.5 4V2.8h5V4"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="15" y2="14"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="14" y2="14.01"/><line x1="18" y1="14" x2="21" y2="14"/><line x1="14" y1="18" x2="14" y2="21"/><line x1="18" y1="18" x2="18" y2="21"/><line x1="21" y1="18" x2="21" y2="21"/>',
  bell: '<path d="M18 15V10a6 6 0 0 0-12 0v5l-2 3h16z"/><path d="M10 21a2.2 2.2 0 0 0 4 0"/>',
  share: '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><line x1="8.3" y1="10.8" x2="15.7" y2="6.2"/><line x1="8.3" y1="13.2" x2="15.7" y2="17.8"/>',
  inbox: '<path d="M3 12h4l2 3h6l2-3h4"/><path d="M5 5h14l2 7v7H3v-7z"/>',
  /* The three tabs along the foot. A scroll for the recipes, a month grid for
     the calendar, three boxes with the first ticked for the shopping. Drawn
     to read at 22px, which is all they are ever shown at. */
  scroll: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v13A2.5 2.5 0 0 1 16.5 21h-9A2.5 2.5 0 0 1 5 18.5z"/><path d="M5 7h14"/><path d="M5 17h14"/><line x1="9" y1="10.5" x2="15" y2="10.5"/><line x1="9" y1="13.5" x2="15" y2="13.5"/>',
  calGrid: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="6"/><line x1="16" y1="3" x2="16" y2="6"/><line x1="9" y1="10" x2="9" y2="21"/><line x1="15" y1="10" x2="15" y2="21"/><line x1="3" y1="15.5" x2="21" y2="15.5"/>',
  checklist: '<rect x="3" y="3.5" width="5.5" height="5.5" rx="1.4"/><polyline points="4.4 6.3 5.5 7.4 7.4 4.9"/><rect x="3" y="9.25" width="5.5" height="5.5" rx="1.4"/><rect x="3" y="15" width="5.5" height="5.5" rx="1.4"/><line x1="11" y1="6.25" x2="21" y2="6.25"/><line x1="11" y1="12" x2="21" y2="12"/><line x1="11" y1="17.75" x2="21" y2="17.75"/>',
  /* The three dots you drag a shopping line by. */
  undo: '<path d="M3 8h11a5.5 5.5 0 0 1 0 11h-6"/><polyline points="7 4 3 8 7 12"/>',
  grip: '<circle cx="12" cy="6" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="18" r="1.35" fill="currentColor" stroke="none"/>'
};
function icon(name, size, extra) {
  size = size || 18;
  const body = ICONS[name] || "";
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="' + (extra || "") + '">' + body + '</svg>';
}

/* ====================================================================== */
/* Helpers                                                                 */
/* ====================================================================== */
const todayStr = () => new Date().toISOString().slice(0, 10);
function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function numOrEmpty(v) {
  if (v === undefined || v === null || v === "") return "";
  const n = parseFloat(v);
  return isNaN(n) ? "" : n;
}
function fmtTime(iso) {
  const d = new Date(iso || "");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const FRACTIONS = [
  [0, ""], [0.125, "⅛"], [0.25, "¼"], [0.333, "⅓"],
  [0.375, "⅜"], [0.5, "½"], [0.625, "⅝"], [0.667, "⅔"],
  [0.75, "¾"], [0.875, "⅞"], [1, ""]
];
function toFraction(value) {
  if (value == null || value === "" || isNaN(value)) return "";
  const whole = Math.floor(value);
  const frac = value - whole;
  let closest = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(f[0] - frac) < Math.abs(closest[0] - frac)) closest = f;
  if (closest[0] === 1) return String(whole + 1);
  if (closest[1] === "") return whole === 0 ? "0" : String(whole);
  return whole === 0 ? closest[1] : whole + " " + closest[1];
}
function formatMetric(value, unit) {
  if (value == null || value === "" || isNaN(value)) return "—";
  if (unit === "each" || !unit) return toFraction(value);
  const v = (unit === "g" || unit === "ml") ? Math.round(value) : Math.round(value * 100) / 100;
  return v + " " + unit;
}
function formatCustomary(value, unit) {
  if (value == null || value === "" || isNaN(value)) return "—";
  if (unit === "each" || !unit) return toFraction(value);
  if (["cup", "tbsp", "tsp"].includes(unit)) return toFraction(value) + " " + unit;
  return (Math.round(value * 100) / 100) + " " + unit;
}
function scaledVal(value, factor) {
  if (value == null || value === "") return null;
  return Number(value) * factor;
}

/* A recipe "body" is the portable part: no ids, no owner, no comments. */
function normalizeBody(r) {
  r = r || {};
  const m = r.macrosPerServing || {};
  return {
    title: (r.title || "Untitled recipe").toString().slice(0, 200),
    description: (r.description || "").toString(),
    source: (r.source && r.source.url) ? { url: String(r.source.url), site: String(r.source.site || "") } : null,
    tags: Array.isArray(r.tags) ? r.tags.filter(Boolean).map(t => String(t).trim()).filter(Boolean) : [],
    servings: {
      base: Number(r.servings && r.servings.base) > 0 ? Number(r.servings.base) : 4,
      unit: (r.servings && r.servings.unit) || "servings"
    },
    macrosPerServing: {
      calories: numOrEmpty(m.calories), proteinG: numOrEmpty(m.proteinG),
      fatG: numOrEmpty(m.fatG), carbsG: numOrEmpty(m.carbsG),
      source: m.source === "site" ? "site" : "estimated"
    },
    ingredients: Array.isArray(r.ingredients) ? r.ingredients.map(i => ({
      name: i.name || "",
      metricValue: numOrEmpty(i.metricValue), metricUnit: i.metricUnit || "",
      customaryValue: numOrEmpty(i.customaryValue), customaryUnit: i.customaryUnit || "",
      notes: i.notes || ""
    })) : [],
    steps: Array.isArray(r.steps) ? r.steps.map(s => ({
      text: s.text || "", timerMinutes: numOrEmpty(s.timerMinutes)
    })) : [],
    notes: r.notes || "",
    mergedFrom: (r.mergedFrom && r.mergedFrom.username) ? r.mergedFrom : null
  };
}

function normalizeSmartQuotes(text) {
  return text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}
function repairStrayQuotes(line) {
  let out = "", inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\\\" && i + 1 < line.length) { out += ch + line[i + 1]; i++; continue; }
    if (ch === '"') {
      if (!inString) { inString = true; out += ch; continue; }
      let j = i + 1;
      while (j < line.length && (line[j] === " " || line[j] === "\\t")) j++;
      const next = line[j];
      if (next === undefined || ",:}]".includes(next)) { inString = false; out += ch; }
      else { out += '\\\\"'; }
      continue;
    }
    out += ch;
  }
  return out;
}
function parseRecipeFile(text) {
  const lines = normalizeSmartQuotes(text).split("\\n").map(l => l.trim()).filter(Boolean);
  const parsed = [], errorLines = [];
  lines.forEach((line, idx) => {
    try {
      const raw = JSON.parse(repairStrayQuotes(line));
      parsed.push({ body: normalizeBody(raw), cookLog: Array.isArray(raw.cookLog) ? raw.cookLog : [] });
    } catch (e) { errorLines.push(idx + 1); }
  });
  return { parsed, errorLines };
}

/* The prompt carries the whole vocabulary, so an AI has no reason to invent
   a tag we would only throw away on import. */
function tagVocabularyText() {
  const lines = [];
  function walk(node, path) {
    const groups = node.groups || [];
    if (groups.length) lines.push(path.join(" > ") + ": " + groups.map(g => g.name).join(", "));
    if ((node.tags || []).length) lines.push(path.join(" > ") + ": " + node.tags.join(", "));
    groups.forEach(g => walk(g, path.concat([g.name])));
  }
  TAG_TREE.forEach(c => walk(c, [c.name]));
  return lines.join(String.fromCharCode(10));
}

const IMPORT_SOURCES = {
  url: {
    label: "From URL", icon: "link",
    intro: "Read the recipe at the URL at the end of this message. Take the facts from it — " +
      "ingredients, quantities, times, temperatures — but write it out in your own words. Do not " +
      "copy the page's sentences. Do not reproduce its headnote, its story, its tips, or any other " +
      "prose surrounding the recipe. Record the URL in the source field.",
    tail: "Recipe to convert:" + String.fromCharCode(10)
  },
  text: {
    label: "From Pasted Text", icon: "clipboard",
    intro: "Read the recipe in the text at the end of this message. Transcribe what is written " +
      "there; do not substitute a similar recipe you already know, and do not fetch anything. If " +
      "something is missing from the text, leave that field empty rather than inventing it.",
    tail: "Recipe to convert:" + String.fromCharCode(10)
  },
  photo: {
    label: "From Photo", icon: "camera",
    intro: "Read the recipe in the photo attached to this message. Take the facts from it — " +
      "ingredients, quantities, times, temperatures — but write the steps out in your own words " +
      "rather than copying the sentences as printed. Do not substitute a similar recipe you already " +
      "know. If part of the photo is unreadable, leave that field empty rather than inventing it.",
    tail: "Recipe to convert: the attached photo."
  },
  chat: {
    label: "From AI Chat", icon: "chat",
    intro: "Use the recipe we have worked out in this conversation. Do not fetch anything and do not " +
      "start over; convert what we already agreed on, including any changes I asked for along the way.",
    tail: "Recipe to convert: the recipe from our conversation above."
  }
};

/* url and text both carry something the AI has to be handed; photo and chat
   point at what is already in front of it. Same prompt either way, so the
   payload just goes on the end. */
const IMPORT_CARRIES_PAYLOAD = { url: true, text: true };
function buildImportPrompt(mode, payload) {
  const src = IMPORT_SOURCES[mode] || IMPORT_SOURCES.url;
  return document.getElementById("import-prompt-template").textContent
    .replace("{{SOURCE}}", src.intro)
    .replace("{{TAG_LIST}}", tagVocabularyText())
    .replace("{{TAIL}}", src.tail) + (IMPORT_CARRIES_PAYLOAD[mode] ? (payload || "") : "");
}

const COOKBOOK_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function randomCookbookId() {
  const bytes = new Uint8Array(10);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < 10; i++) s += COOKBOOK_ALPHABET[bytes[i] % COOKBOOK_ALPHABET.length];
  return s;
}

/* ====================================================================== */
/* State                                                                   */
/* ====================================================================== */
const state = {
  session: null,
  loading: true,
  view: "library",
  activeId: null,
  recipes: [],
  comments: {},
  mates: [],
  friends: [],
  incoming: [],
  outgoing: [],
  declined: [],
  search: "",
  activeTags: [],
  _fopen: {},
  /* The box opens on your own shelf. Everyone else's is a deliberate look
     rather than the thing you land on. Note this counts as a filter, so the
     export button offers what is actually on screen. */
  ownerFilter: "ours",
  friendsTab: "friends",
  myHousehold: "",
  marks: { pin: [], star: [], later: [] },
  shares: {},
  /* Which friends are ticked in the visibility sheet, while it is open. */
  visDraft: [],
  /* A recipe arrived at by share link. Held apart from state.recipes because
     it is not in this cookbook and may never be - the library is what you
     own or were given, and this is neither until it is pinned. */
  linkRecipe: null,
  linkError: "",
  /* Autofills the friends page when an author's name is tapped. */
  friendPrefill: "",
  pickSearch: "",
  sort: "newest",
  scale: 1,
  customScaleOpen: false,
  editDraft: null,
  editIsNew: false,
  editBaseUpdatedAt: null,
  editForce: false,
  watch: null,
  change: null,
  conflict: null,
  lockHeld: null,
  lockedInfo: null,
  modal: null,
  modalError: "",
  intent: null,
  logRating: 0,
  importParsed: [],
  importErrors: [],
  importVisibility: "",
  importFileName: null,
  urlToRecipe: { mode: "url", url: "", text: "", prompt: "", generated: false },
  busy: false,
  _tagList: [],
  _showAllLogs: false,
  /* --- meal plan and shopping ---
     Both belong to the cookbook rather than the person, the same way marks
     do: one household keeps one calendar and one shelf of lists. Items for a
     list are fetched when the list is opened, so the sync payload stays the
     size of an index however much shopping has piled up. */
  schedule: [],
  groceryLists: [],
  groceryItems: {},
  activeListId: null,
  scheduleDraft: null,
  scheduledFor: null,
  groceryRange: { start: "", end: "" },
  groceryMergeFrom: null,
  /* Which line has its editor open, and which field wanted the focus. Kept
     on state rather than on the item: it is a view detail, and putting it in
     the item would ship it to D1 on every tap. */
  groceryOpenId: null,
  groceryOpenFocus: "name",
  /* At most one row sits open on its swipe action at a time. */
  grocerySwipedId: null,
  /* Both bands start shut and reopen shut next time. A view detail, never
     written to the list. */
  grocerySections: { basket: false, removed: false },
  /* What the scan proposed, awaiting a yes. Never applied unreviewed. */
  groceryMergePlan: [],
  /* Staples the kitchen is assumed to have. Cookbook-wide, and consulted at
     exactly one moment: building a list. */
  exclusions: [],
  exclusionDraft: null,
  calDay: null,
  _calTop: null,
  schedWeekTop: null,
  calBack: 6,
  calFwd: 6,
  pendingDeleteList: null,
  pendingRenameList: null,
  daySearch: "",
  /* ---- community meals ----
     meals is the server's word on it. mealDraft is the sheet being filled in,
     mealFocus the tile a notification asked us to land on, and mealDishSearch
     is keyed per meal so two open tiles do not share one search box. */
  meals: [],
  mealDraft: null,
  mealFocus: null,
  /* The guest picker's own search box. Kept off the draft because it is a
     view of the list rather than part of the meal being written, and it is
     cleared whenever either sheet opens. */
  mealFriendSearch: "",
  mealDishSearch: {},
  mealDishPick: {},
  mealPastOpen: {}
};

/* ---- dates, in the calendar's terms ----------------------------------- */
/* todayStr() is UTC, which is right for a cook-log date the server also
   reads and wrong for a grid where "today" has to be the square the person
   is actually living in. Anything the calendar touches uses these instead:
   the local Y-M-D, compared as plain strings because zero-padded dates sort
   the way dates do. */
function ymd(d) {
  const p = n => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function localToday() { return ymd(new Date()); }
function fromYmd(k) {
  const a = String(k || "").split("-");
  return new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
}
function addDays(k, n) { const d = fromYmd(k); d.setDate(d.getDate() + n); return ymd(d); }
/* The Sunday that starts the week a date falls in. */
function sundayOf(k) { const d = fromYmd(k); d.setDate(d.getDate() - d.getDay()); return ymd(d); }
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(k) {
  const d = fromYmd(k);
  return DOW[d.getDay()] + ", " + MON[d.getMonth()] + " " + d.getDate();
}
/* m/d/yy, for naming a list the way the person would say it out loud. */
function slashDate(k) {
  const d = fromYmd(k);
  return (d.getMonth() + 1) + "/" + d.getDate() + "/" + String(d.getFullYear()).slice(2);
}
/* m/d, which is all a list name needs. The old name carried the range, the
   day it was made, the date it was made, the year and the time - four
   restatements of the same week, wrapping to two lines on a phone. The year
   is on the created date if it is ever wanted; the range is the thing you
   pick a list by. A single-day range says one date rather than saying it
   twice. */
function shortDay(k) { const d = fromYmd(k); return (d.getMonth() + 1) + "/" + d.getDate(); }
function rangeLabel(start, end) {
  const a = shortDay(start), b = shortDay(end);
  return a === b ? a : (a + " - " + b);
}
/* Two lists for the same days are a real thing to do - a second shop later
   in the week - so they are not refused, just told apart. Only ever appended
   on an actual collision, so the ordinary case stays clean. */
function uniqueListLabel(base, lists) {
  const taken = {};
  (lists || []).forEach(function (L) { taken[String(L.label)] = 1; });
  if (!taken[base]) return base;
  for (let n = 2; n < 200; n++) {
    const tryIt = base + " (" + n + ")";
    if (!taken[tryIt]) return tryIt;
  }
  return base;
}

function getActiveRecipe() { return state.recipes.find(r => r.recipeId === state.activeId) || null; }
function recipeById(id) { return state.recipes.find(r => r.recipeId === id) || null; }
function entryById(id) { return state.schedule.find(e => e.entryId === id) || null; }
function scheduleOn(key) { return state.schedule.filter(e => e.date === key); }
/* The Sun-Sat week that today falls in, not the week the grid happens to be
   scrolled to. The line is a standing answer to "what am I cooking this
   week", and that question does not change because you scrolled back to
   March to see what you ate. */
function mealById(id) { return state.meals.filter(m => m.mealId === id)[0] || null; }

/* Which schedule entries exist because of a community meal. Used to colour
   the chip and to label the entry in the day sheet. */
function mealEntryIds() {
  const set = {};
  state.meals.forEach(function (m) {
    m.dishes.forEach(function (d) { if (d.entryId) set[d.entryId] = m.mealId; });
  });
  return set;
}
function mealForEntry(entryId) {
  const id = mealEntryIds()[entryId];
  return id ? mealById(id) : null;
}

/* Whole-day, time ignored: a dinner is still tonight's dinner at ten past
   nine, and a tile that collapses itself mid-meal would be worse than one
   that waits until tomorrow. */
function isMealPast(m) { return String(m.date) < localToday(); }

function sortedMeals() {
  const live = [], past = [];
  state.meals.forEach(function (m) { (isMealPast(m) ? past : live).push(m); });
  live.sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
  past.sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
  return { live, past };
}

/* Two cookbooks bringing the same thing is allowed and, at a table, usually
   fine. It is worth saying out loud on the tile rather than showing the same
   line twice and leaving everyone to notice. */
function dishTitleCounts(meal) {
  const n = {};
  meal.dishes.forEach(function (d) {
    const k = String(d.title).trim().toLowerCase();
    n[k] = (n[k] || 0) + 1;
  });
  return n;
}
function dishDisplayTitle(meal, dish, counts) {
  const k = String(dish.title).trim().toLowerCase();
  return (counts[k] > 1 ? "Lots of " : "") + dish.title;
}

function weekScheduledCount() {
  const from = sundayOf(localToday()), to = addDays(from, 6);
  return state.schedule.filter(e => e.date >= from && e.date <= to).length;
}
/* A scheduled portion count against the recipe's own base. The recipe view
   works in multiples, the calendar works in mouths to feed, and this is the
   one place the two meet. */
function factorFor(r, servings) {
  const base = (r && r.servings && Number(r.servings.base) > 0) ? Number(r.servings.base) : 1;
  const want = Number(servings) > 0 ? Number(servings) : base;
  return want / base;
}

/* ---- grocery arithmetic ----------------------------------------------- */
/* One line per ingredient name. A name that turns up in two different units
   keeps a segment for each: 250 g and 1 cup cannot be added without knowing
   what the thing weighs, and guessing would be worse than showing both. */
function segKey(s) { return (s.mu || "") + "|" + (s.cu || ""); }
/* Two segments can be added when their metric units agree and their
   customary units either agree or one of them simply is not there. One
   recipe giving "15 g (1/4 cup)" and another giving "10 g" of the same thing
   is 25 g of it; refusing to add them because only one bothered with cups
   left the line reading "15 g (1/4 cup) + 10 g", which is a sum the person
   then has to do in the shop. */
function segCompatible(a, b) {
  if ((a.mu || "") !== (b.mu || "")) return false;
  const ca = a.cu || "", cb = b.cu || "";
  return ca === cb || !ca || !cb;
}
function addSeg(list, seg) {
  for (const s of list) {
    if (!segCompatible(s, seg)) continue;
    if (seg.mv != null) s.mv = (s.mv == null ? 0 : s.mv) + seg.mv;
    const sameCu = (s.cu || "") === (seg.cu || "");
    if (sameCu) {
      if (seg.cv != null) s.cv = (s.cv == null ? 0 : s.cv) + seg.cv;
    } else if ((s.cv == null) && (s.cu || "") === "") {
      /* This side never had a second unit; adopt the other's outright. */
      s.cv = seg.cv; s.cu = seg.cu || "";
    } else {
      /* One side had no second unit to contribute, so the pair no longer
         describes the total. Better to carry one honest number than two
         where the bracketed one quietly understates. */
      s.cv = null; s.cu = "";
    }
    return list;
  }
  list.push({ mv: seg.mv, mu: seg.mu || "", cv: seg.cv, cu: seg.cu || "" });
  return list;
}

/* Does this ingredient line match something on the staples list?
   The test is a tail match on the reduced name, not equality and not a
   substring. Tail, because English puts the thing last: "kosher salt" and
   "coarse sea salt" are both salt, and "black pepper" is what "freshly
   ground black pepper" is. A plain substring would take "ice" out of "ice
   cream", which is how a shopping list quietly stops containing pudding.
   Colours still have to agree, so excluding "black pepper" leaves red
   pepper flakes exactly where they were. */
function excludedByStaples(name, exclusions) {
  if (!exclusions || !exclusions.length) return false;
  const n = normalizeGroceryName(name);
  if (!n.base) return false;
  const words = n.base.split(" ");
  for (let e = 0; e < exclusions.length; e++) {
    const x = normalizeGroceryName(exclusions[e]);
    if (!x.base) continue;
    if (x.colors !== n.colors) continue;
    const xw = x.base.split(" ");
    if (xw.length > words.length) continue;
    let hit = true;
    for (let i = 0; i < xw.length; i++) {
      if (words[words.length - xw.length + i] !== xw[i]) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}

function buildGroceryItems(start, end) {
  const byName = {}, order = [];
  state.schedule.forEach(function (e) {
    if (!e.date || e.date < start || e.date > end) return;
    const r = recipeById(e.recipeId);
    if (!r) return;                       /* orphan: nothing left to shop for */
    const f = factorFor(r, e.servings);
    (r.ingredients || []).forEach(function (ing) {
      const name = String(ing.name || "").trim();
      if (!name) return;
      /* The one place staples are consulted. Lists already built are left
         exactly as they are - this changes what the next one contains, and
         nothing that is already on a shelf. */
      if (excludedByStaples(name, state.exclusions)) return;
      const key = name.toLowerCase();
      if (!byName[key]) {
        byName[key] = { id: "", name: name, checked: false, removed: false, from: [], qty: [] };
        order.push(key);
      }
      const item = byName[key];
      if (item.from.indexOf(r.title) < 0) item.from.push(r.title);
      addSeg(item.qty, {
        mv: (ing.metricValue === "" || ing.metricValue == null) ? null : Number(ing.metricValue) * f,
        mu: ing.metricUnit || "",
        cv: (ing.customaryValue === "" || ing.customaryValue == null) ? null : Number(ing.customaryValue) * f,
        cu: ing.customaryUnit || ""
      });
    });
  });
  const out = order.map(k => byName[k]);
  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  out.forEach(function (it, i) {
    it.id = "g" + (i + 1);
    it.qty.forEach(function (s) {
      if (s.mv != null) s.mv = Math.round(s.mv * 1000) / 1000;
      if (s.cv != null) s.cv = Math.round(s.cv * 1000) / 1000;
    });
  });
  return out;
}

/* ---- telling two spellings of one ingredient apart --------------------- */
/* Words that describe what you do to a thing in the kitchen, not what you
   pick up in the shop. "Chopped cilantro" and "fresh cilantro" are one bunch
   of cilantro, so these come off before two names are compared. */
const GROC_PREP = {
  chopped: 1, minced: 1, diced: 1, sliced: 1, shredded: 1, grated: 1, crushed: 1,
  mashed: 1, melted: 1, softened: 1, beaten: 1, cubed: 1, julienned: 1, halved: 1,
  quartered: 1, torn: 1, trimmed: 1, peeled: 1, seeded: 1, deseeded: 1, cored: 1,
  stemmed: 1, rinsed: 1, drained: 1, cooked: 1, warmed: 1, cooled: 1, chilled: 1,
  packed: 1, heaping: 1, level: 1, divided: 1, optional: 1, plus: 1, more: 1,
  fresh: 1, freshly: 1, finely: 1, coarsely: 1, roughly: 1, thinly: 1, thickly: 1,
  lightly: 1, well: 1, very: 1, and: 1, or: 1, of: 1, to: 1, taste: 1, for: 1,
  garnish: 1, serving: 1
};
/* Everything not in that list stays significant, which is what keeps "ground
   beef" away from "beef" and "dried oregano" away from "oregano" without
   needing a second list to say so. */
const GROC_COLORS = {
  red: 1, green: 1, yellow: 1, white: 1, black: 1, brown: 1,
  purple: 1, pink: 1, blue: 1, golden: 1, orange: 1
};

function grocSingular(w) {
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (/oes$/.test(w)) return w.slice(0, -2);
  if (/ss$/.test(w)) return w;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

/* A name reduced to the thing you actually buy, plus the colours that were
   attached to it. Colour is never dropped: a red onion and a yellow onion
   are two different things to come home with, and folding them would be a
   silent wrong answer rather than a missed convenience.
   Orange is the awkward one - it is a colour and it is a fruit - so it only
   counts as a colour when something else follows it to be the colour of. */
function normalizeGroceryName(raw) {
  const words = String(raw || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\\s+/);
  const kept = [];
  words.forEach(function (w) { if (w && !GROC_PREP[w]) kept.push(w); });
  const colors = [], base = [];
  kept.forEach(function (w, i) {
    if (GROC_COLORS[w]) {
      /* Something after it that is not itself a colour makes this a colour. */
      let qualifies = false;
      for (let n = i + 1; n < kept.length; n++) if (!GROC_COLORS[kept[n]]) { qualifies = true; break; }
      if (qualifies) { colors.push(w); return; }
    }
    base.push(grocSingular(w));
  });
  /* Stems are for comparing, never for showing. "Molasses" stems to
     "molass", which is fine as a key and would be an embarrassment as the
     name left on the list, so what gets displayed is the words as written
     with only the prep taken off. */
  return {
    base: base.join(" "),
    colors: colors.slice().sort().join(","),
    display: kept.join(" "),
    key: colors.slice().sort().join(",") + "|" + base.join(" ")
  };
}

/* What the scan proposes, never what it does. Only lines still to get: a
   line already in the basket has been found and picked up, and folding it
   into something you are still looking for would lose track of both. */
function groceryMergePlan(items) {
  const groups = {}, order = [];
  (items || []).forEach(function (i) {
    if (i.removed || i.checked) return;
    const n = normalizeGroceryName(i.name);
    if (!n.base) return;
    if (!groups[n.key]) { groups[n.key] = { key: n.key, into: n.display, ids: [], names: [] }; order.push(n.key); }
    /* The shortest way anyone on this list wrote the thing wins. It is a
       real name someone typed rather than something assembled, and the
       shortest is the one with the least prep clinging to it. */
    if (n.display.length < groups[n.key].into.length) groups[n.key].into = n.display;
    groups[n.key].ids.push(i.id);
    groups[n.key].names.push(i.name);
  });
  const out = [];
  order.forEach(function (k) {
    const g = groups[k];
    if (g.ids.length > 1) out.push({ key: k, into: g.into, ids: g.ids, names: g.names, on: true });
  });
  return out;
}

/* Two lines the person says are the same thing. Quantities add; the name
   that survives is the one they picked second, which is the point - "Red
   onion" folds into "Onion, red" because that is how their shop is laid
   out, not because either spelling is more correct. */
function mergeGroceryItems(items, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return items.slice();
  const src = items.filter(i => i.id === fromId)[0];
  const dst = items.filter(i => i.id === toId)[0];
  if (!src || !dst) return items.slice();
  const qty = dst.qty.map(s => ({ mv: s.mv, mu: s.mu, cv: s.cv, cu: s.cu }));
  src.qty.forEach(s => addSeg(qty, s));
  const from = dst.from.slice();
  src.from.forEach(function (f) { if (from.indexOf(f) < 0) from.push(f); });
  return items
    .filter(i => i.id !== fromId)
    .map(i => (i.id === toId ? Object.assign({}, i, { qty: qty, from: from }) : i));
}

function reorderGroceryItems(items, id, toIndex) {
  const out = items.slice();
  let from = -1;
  for (let i = 0; i < out.length; i++) if (out[i].id === id) { from = i; break; }
  if (from < 0) return out;
  const moved = out.splice(from, 1)[0];
  out.splice(Math.max(0, Math.min(out.length, toIndex)), 0, moved);
  return out;
}

/* What a segment reads as on the list: metric first, customary in brackets,
   exactly as the recipe shows it. */
function segText(s) {
  const bits = [];
  if (s.mv != null) bits.push(formatMetric(s.mv, s.mu));
  /* Countable things carry the same number in both fields - two and a half
     peppers are two and a half peppers - and "2 1/2 (2 1/2)" is the same
     fact twice in a chip with no width to spare. */
  const echo = (s.mv != null && s.cv != null &&
    (s.mu || "") === (s.cu || "") && Number(s.mv) === Number(s.cv));
  if (s.cv != null && !echo) {
    bits.push(s.mv != null ? "(" + formatCustomary(s.cv, s.cu) + ")" : formatCustomary(s.cv, s.cu));
  }
  return bits.join(" ") || "—";
}
function qtyText(item) { return (item.qty || []).map(segText).join(" + "); }
function groceryItemsFor(listId) { return state.groceryItems[listId] || []; }

/* The list keeps itself in three bands: still to get, already in the basket,
   and not needed. Within a band the stored order is left alone, so dragging
   still works and only ever rearranges things inside their own band - a row
   dragged across a boundary settles at the edge of the one it belongs to
   rather than sitting in a section that contradicts its own checkbox. */
function normalizeGroceryOrder(items) {
  const live = items.filter(i => !i.removed);
  return live.filter(i => !i.checked)
    .concat(live.filter(i => i.checked))
    .concat(items.filter(i => i.removed));
}
/* Anything added by hand needs an id that cannot collide with the g1..gN the
   builder hands out, nor with another manual line added seconds later. */
function nextGroceryId(items) {
  const taken = {};
  items.forEach(function (i) { taken[i.id] = true; });
  let n = items.length + 1;
  while (taken["u" + n]) n++;
  return "u" + n;
}
function commentsFor(id) { return state.comments[id] || []; }
function statsFor(id) {
  const list = commentsFor(id);
  if (!list.length) return { count: 0, avg: null };
  return { count: list.length, avg: list.reduce((a, c) => a + (c.rating || 0), 0) / list.length };
}

function toast(msg) {
  const root = document.getElementById("toast-root");
  root.innerHTML = '<div class="toast">' + esc(msg) + '</div>';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { root.innerHTML = ""; }, 3200);
}

/* ====================================================================== */
/* Session + API                                                           */
/* ====================================================================== */
/* ====================================================================== */
/* Scanned links                                                           */
/* ====================================================================== */
/* Both codes land on the ordinary front door with one parameter on the end.
   Nothing happens on arrival: the parameter is read, the address bar is
   tidied so a refresh cannot fire it twice, and then we ask. If there is no
   cookbook on the device yet the intent waits in storage until there is, so
   scanning a code and signing up in one go still ends where it meant to. */
const INTENT_KEY = "recipeBoxPendingIntent";
function readIntentFromUrl() {
  if (typeof window === "undefined" || !window.location) return null;
  let intent = null;
  try {
    const q = new URLSearchParams(window.location.search || "");
    const r = q.get("r"), f = q.get("f");
    if (r) intent = { type: "recipe", recipeId: String(r).slice(0, 64) };
    else if (f) intent = { type: "friend", name: String(f).slice(0, 40) };
  } catch (e) { return null; }
  if (intent && window.history && window.history.replaceState) {
    try { window.history.replaceState({}, "", window.location.pathname); } catch (e) {}
  }
  return intent;
}
function stashIntent(intent) {
  try { localStorage.setItem(INTENT_KEY, JSON.stringify(intent)); } catch (e) {}
}
function takeStashedIntent() {
  try {
    const raw = localStorage.getItem(INTENT_KEY);
    localStorage.removeItem(INTENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

const SESSION_KEY = "recipeBoxSession";
function loadSession() {
  try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }

async function API(path, payload) {
  const creds = state.session ? { username: state.session.username, cookbookId: state.session.cookbookId } : {};
  const res = await fetch("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({}, creds, payload || {}))
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || ("Request failed (" + res.status + ")"));
    err.code = data && data.code;
    err.detail = (data && data.detail) || null;
    if (err.code === "AUTH" && state.session) {
      clearSession();
      state.session = null;
      state.view = "welcome";
    }
    throw err;
  }
  return data;
}

function applyLibrary(data) {
  state.recipes = (data.recipes || []).map(row => Object.assign({}, normalizeBody(row.data), {
    recipeId: row.recipeId,
    owner: row.owner,
    household: row.household || row.owner,
    ours: !!row.ours,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
  state.comments = data.comments || {};
  state.myHousehold = (data.me && data.me.household) || state.session.username;
  state.marks = data.marks || { pin: [], star: [], later: [] };
  state.shares = data.shares || {};
  state.mates = data.mates || [];
  state.friends = data.friends || [];
  state.incoming = data.incoming || [];
  state.outgoing = data.outgoing || [];
  state.declined = data.declined || [];
  state.schedule = data.schedule || [];
  state.meals = data.meals || [];
  state.groceryLists = data.groceryLists || [];
  state.exclusions = Array.isArray(data.exclusions) ? data.exclusions : [];
}

async function refreshLibrary(showLoading) {
  if (showLoading) { state.loading = true; renderApp(); }
  try {
    const data = await API("library");
    applyLibrary(data);
  } catch (e) {
    if (e.code !== "AUTH") toast("Couldn't load your recipes — " + e.message);
  } finally {
    state.loading = false;
    renderApp();
  }
}

/* ====================================================================== */
/* Render: Welcome                                                         */
/* ====================================================================== */
function WelcomeViewHTML() {
  const suggested = state._suggestedCookbook || (state._suggestedCookbook = randomCookbookId());
  return '' +
    '<div class="welcome-wrap">' +
      '<span style="color:var(--accent)">' + icon("book", 34) + '</span>' +
      '<h1 class="font-display">The Recipe Box</h1>' +
      '<p class="lede">Pick a name your friends will see on your ratings and comments, then start a cookbook — or enter an existing Cookbook ID to open it on this device or join a household cookbook.</p>' +
      (state._arrivedByScan
        ? '<div class="import-summary">Someone shared something with you. Set up a cookbook here and it will pick up where the code left off.</div>'
        : "") +
      (state.modalError ? '<div class="modal-error">' + esc(state.modalError) + '</div>' : "") +
      '<div class="field"><label>Username</label>' +
        '<input type="text" id="w-username" autocapitalize="none" autocorrect="off" spellcheck="false" value="' + esc(state._wUsername || "") + '" />' +
      '</div>' +
      '<div class="field"><label>Cookbook ID</label>' +
        '<input type="text" id="w-cookbook" class="font-mono code-box" style="text-transform:uppercase" autocapitalize="characters" autocorrect="off" spellcheck="false" value="' + esc(state._wCookbook !== undefined ? state._wCookbook : suggested) + '" />' +
        '<div style="display:flex; gap:8px">' +
          '<button class="btn btn-sm" onclick="Actions.regenerateCookbook()">' + icon("sync", 14) + ' New ID</button>' +
          '<button class="btn btn-sm" onclick="Actions.copyCookbookField()">' + icon("copy", 14) + ' Copy</button>' +
        '</div>' +
      '</div>' +
      '<div class="warn-box"><b>Your Cookbook ID is your password.</b> Anyone who has it can read, edit and delete every recipe in the cookbook, and is linked to all of its friends. Share it only with people you cook with, or to open the same cookbook on another one of your devices. It cannot be reset or recovered, so save it somewhere safe.</div>' +
      '<button class="btn btn-primary btn-block" onclick="Actions.submitSession()">Open my recipe box</button>' +
      '<p class="helper-text" style="margin-top:14px">Coming back? Use the same username and Cookbook ID as before. Sharing a kitchen? Use your own username with the household\\'s Cookbook ID.</p>' +
    '</div>';
}

/* ====================================================================== */
/* Render: Library                                                         */
/* ====================================================================== */
function ratingHTML(avg, count) {
  if (avg == null) return '<span class="no-rating">Not yet cooked</span>';
  const rounded = Math.round(avg);
  let stars = "";
  for (let n = 1; n <= 5; n++) stars += icon("star", 14, n <= rounded ? "star-filled" : "star-empty");
  return '<span class="stars"><span style="display:inline-flex">' + stars + '</span>' +
    '<span class="font-mono">' + avg.toFixed(1) + '</span><span>(' + count + ')</span></span>';
}
function starsOnly(rating) {
  let stars = "";
  for (let n = 1; n <= 5; n++) stars += icon("star", 13, n <= rating ? "star-filled" : "star-empty");
  return '<span class="stars"><span style="display:inline-flex">' + stars + '</span></span>';
}
/* In a shared cookbook, "private" would be a lie: everyone in the cookbook
   can already see and edit it. */
function privateLabel() { return state.mates.length ? "Just us" : "Private"; }
/* The three tiers, named for what they do rather than what they hide.
   Selective and All friends can both be handed out as a link or a code;
   private cannot, so a private recipe shows neither. */
function visibilityLabel(v) {
  return v === "friends" ? "All friends" : v === "selective" ? "Selective share" : privateLabel();
}
function visibilityIcon(v, px) {
  return v === "friends" ? icon("globe", px) : v === "selective" ? icon("userPlus", px) : icon("lock", px);
}
function canShareRecipe(r) { return !!r && (r.visibility === "friends" || r.visibility === "selective"); }
/* ====================================================================== */
/* QR codes                                                                */
/* ====================================================================== */
/* Written out here rather than stored: a code is a pure function of the URL
   it carries, and the URL is a pure function of the recipe id we already
   have. Keeping the SVG in the recipe body would put ~16KB per recipe into
   the blob the library endpoint returns in full on every refresh, to save
   about four milliseconds of arithmetic that only happens once per code.
   Byte mode, versions 1-10, spec mask selection. Verified against the
   fixed app code this replaces: identical on every data and function
   module. */
var QR_TOTAL = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
/* [ecPerBlock, blocks1, dataPerBlock1, blocks2, dataPerBlock2] */
var QR_EC = {
  L: [[7,1,19,0,0],[10,1,34,0,0],[15,1,55,0,0],[20,1,80,0,0],[26,1,108,0,0],
      [18,2,68,0,0],[20,2,78,0,0],[24,2,97,0,0],[30,2,116,0,0],[18,2,68,2,69]],
  M: [[10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],
      [16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44]],
  Q: [[13,1,13,0,0],[22,1,22,0,0],[18,2,17,0,0],[26,2,24,0,0],[18,2,15,2,16],
      [24,4,19,0,0],[18,2,14,4,15],[22,4,18,2,19],[20,4,16,4,17],[24,6,19,2,20]],
  H: [[17,1,9,0,0],[28,1,16,0,0],[22,2,13,0,0],[16,4,9,0,0],[22,2,11,2,12],
      [28,4,15,0,0],[26,4,13,1,14],[26,4,14,2,15],[24,4,12,4,13],[28,6,15,2,16]]
};
var QR_ALIGN = [[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
var QR_LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

var GF_EXP = new Uint8Array(512), GF_LOG = new Uint8Array(256);
(function () {
  var x = 1;
  for (var i = 0; i < 255; i++) {
    GF_EXP[i] = x; GF_LOG[x] = i;
    x <<= 1; if (x & 256) x ^= 0x11d;
  }
  for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
})();
function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]; }

/* Descending coefficient order, which is what the division below wants. */
function rsGenerator(n) {
  var poly = [1], i, j;
  for (i = 0; i < n; i++) {
    var next = [];
    for (j = 0; j <= poly.length; j++) next.push(0);
    for (j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], GF_EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly.reverse();
}
function rsEncode(data, n) {
  var gen = rsGenerator(n), res = [], i, j;
  for (i = 0; i < data.length; i++) res.push(data[i]);
  for (i = 0; i < n; i++) res.push(0);
  for (i = 0; i < data.length; i++) {
    var lead = res[i];
    if (!lead) continue;
    for (j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], lead);
  }
  return res.slice(data.length);
}

function bchDigit(v) { var n = 0; while (v !== 0) { n++; v >>>= 1; } return n; }
function qrFormatBits(level, mask) {
  var d = (QR_LEVEL_BITS[level] << 3) | mask, v = d << 10;
  while (bchDigit(v) - bchDigit(0x537) >= 0) v ^= 0x537 << (bchDigit(v) - bchDigit(0x537));
  return ((d << 10) | v) ^ 0x5412;
}
function qrVersionBits(version) {
  var v = version << 12;
  while (bchDigit(v) - bchDigit(0x1f25) >= 0) v ^= 0x1f25 << (bchDigit(v) - bchDigit(0x1f25));
  return (version << 12) | v;
}

function qrUtf8(str) {
  var out = [], i, c;
  for (i = 0; i < str.length; i++) {
    c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
      var c2 = str.charCodeAt(++i);
      var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function qrCodewords(bytes, version, level) {
  var e = QR_EC[level][version - 1];
  var cap = e[1] * e[2] + e[3] * e[4];
  var bits = [], i, j, k;
  function push(val, len) { for (var b = len - 1; b >= 0; b--) bits.push((val >> b) & 1); }
  push(4, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (i = 0; i < bytes.length; i++) push(bytes[i], 8);
  var room = cap * 8;
  if (bits.length > room) return null;
  for (i = 0; i < 4 && bits.length < room; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  var words = [];
  for (i = 0; i < bits.length; i += 8) {
    var v = 0;
    for (k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
    words.push(v);
  }
  var pad = [0xec, 0x11], p = 0;
  while (words.length < cap) words.push(pad[p++ % 2]);

  var spec = [], blocks = [], at = 0;
  for (i = 0; i < e[1]; i++) spec.push(e[2]);
  for (i = 0; i < e[3]; i++) spec.push(e[4]);
  for (i = 0; i < spec.length; i++) {
    var d = words.slice(at, at + spec[i]); at += spec[i];
    blocks.push({ data: d, ec: rsEncode(d, e[0]) });
  }
  var out = [], maxData = 0;
  for (i = 0; i < spec.length; i++) if (spec[i] > maxData) maxData = spec[i];
  for (i = 0; i < maxData; i++) {
    for (j = 0; j < blocks.length; j++) if (i < blocks[j].data.length) out.push(blocks[j].data[i]);
  }
  for (i = 0; i < e[0]; i++) {
    for (j = 0; j < blocks.length; j++) out.push(blocks[j].ec[i]);
  }
  return out;
}

function qrMaskAt(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function qrBuildMatrix(version, level, words, mask) {
  var n = version * 4 + 17, m = [], res = [], i, j, dr, dc;
  for (i = 0; i < n; i++) {
    var rowA = [], rowB = [];
    for (j = 0; j < n; j++) { rowA.push(false); rowB.push(false); }
    m.push(rowA); res.push(rowB);
  }
  function finder(r0, c0) {
    for (dr = -1; dr <= 7; dr++) {
      for (dc = -1; dc <= 7; dc++) {
        var rr = r0 + dr, cc = c0 + dc;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        var on = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                 (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                 (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        m[rr][cc] = on; res[rr][cc] = true;
      }
    }
  }
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (i = 8; i < n - 8; i++) {
    m[6][i] = i % 2 === 0; res[6][i] = true;
    m[i][6] = i % 2 === 0; res[i][6] = true;
  }
  var ac = QR_ALIGN[version - 1];
  for (i = 0; i < ac.length; i++) {
    for (j = 0; j < ac.length; j++) {
      var r1 = ac[i], c1 = ac[j];
      if (res[r1][c1]) continue;
      for (dr = -2; dr <= 2; dr++) {
        for (dc = -2; dc <= 2; dc++) {
          var far = Math.abs(dr) > Math.abs(dc) ? Math.abs(dr) : Math.abs(dc);
          m[r1 + dr][c1 + dc] = far !== 1; res[r1 + dr][c1 + dc] = true;
        }
      }
    }
  }
  for (i = 0; i <= 8; i++) {
    if (!res[8][i]) { res[8][i] = true; m[8][i] = false; }
    if (!res[i][8]) { res[i][8] = true; m[i][8] = false; }
  }
  for (i = 0; i < 8; i++) {
    res[8][n - 1 - i] = true; m[8][n - 1 - i] = false;
    res[n - 1 - i][8] = true; m[n - 1 - i][8] = false;
  }
  m[n - 8][8] = true; res[n - 8][8] = true;
  if (version >= 7) {
    var vb = qrVersionBits(version);
    for (i = 0; i < 18; i++) {
      var vbit = ((vb >> i) & 1) === 1, vr = Math.floor(i / 3), vc = i % 3;
      m[n - 11 + vc][vr] = vbit; res[n - 11 + vc][vr] = true;
      m[vr][n - 11 + vc] = vbit; res[vr][n - 11 + vc] = true;
    }
  }
  var bitIdx = 0, total = words.length * 8;
  function nextBit() {
    if (bitIdx >= total) return false;
    var v = (words[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
    bitIdx++;
    return v === 1;
  }
  var up = true;
  for (var col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (var k = 0; k < n; k++) {
      var row = up ? n - 1 - k : k;
      for (var s = 0; s < 2; s++) {
        var cc2 = col - s;
        if (res[row][cc2]) continue;
        var v2 = nextBit();
        if (qrMaskAt(mask, row, cc2)) v2 = !v2;
        m[row][cc2] = v2; res[row][cc2] = true;
      }
    }
    up = !up;
  }
  var fb = qrFormatBits(level, mask);
  for (i = 0; i < 15; i++) {
    var b2 = ((fb >> i) & 1) === 1;
    if (i < 6) m[i][8] = b2;
    else if (i < 8) m[i + 1][8] = b2;
    else if (i === 8) m[8][7] = b2;
    else m[8][14 - i] = b2;
    if (i < 8) m[8][n - 1 - i] = b2;
    else m[n - 15 + i][8] = b2;
  }
  return m;
}

/* The spec's four penalties. Choosing the mask this way rather than fixing
   one is what keeps a code readable against an awkward payload. */
function qrPenalty(m) {
  var n = m.length, score = 0, i, j, run, dark = 0;
  for (i = 0; i < n; i++) {
    run = 1;
    for (j = 1; j < n; j++) {
      if (m[i][j] === m[i][j - 1]) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) score += 3 + (run - 5);
    run = 1;
    for (j = 1; j < n; j++) {
      if (m[j][i] === m[j - 1][i]) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (i = 0; i < n - 1; i++) {
    for (j = 0; j < n - 1; j++) {
      var a = m[i][j];
      if (a === m[i][j + 1] && a === m[i + 1][j] && a === m[i + 1][j + 1]) score += 3;
    }
  }
  var p1 = [true, false, true, true, true, false, true, false, false, false, false];
  var p2 = [false, false, false, false, true, false, true, true, true, false, true];
  for (i = 0; i < n; i++) {
    for (j = 0; j + 11 <= n; j++) {
      var h1 = true, h2 = true, v1 = true, v2 = true;
      for (var k = 0; k < 11; k++) {
        if (m[i][j + k] !== p1[k]) h1 = false;
        if (m[i][j + k] !== p2[k]) h2 = false;
        if (m[j + k][i] !== p1[k]) v1 = false;
        if (m[j + k][i] !== p2[k]) v2 = false;
      }
      if (h1 || h2) score += 40;
      if (v1 || v2) score += 40;
    }
  }
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (m[i][j]) dark++;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

function qrMatrix(text, level) {
  level = level || "M";
  var bytes = qrUtf8(text), words = null, version = 0;
  for (var v = 1; v <= 10; v++) {
    words = qrCodewords(bytes, v, level);
    if (words) { version = v; break; }
  }
  if (!words) return null;
  var best = null, bestScore = -1;
  for (var mk = 0; mk < 8; mk++) {
    var m = qrBuildMatrix(version, level, words, mk);
    var s = qrPenalty(m);
    if (bestScore < 0 || s < bestScore) { bestScore = s; best = m; }
  }
  return best;
}

/* One cache for the life of the page. A code is only ever asked for again
   with the same text, so every view after the first is free. */
var QR_CACHE = {};
function qrSvgHTML(text, px, label) {
  var key = text + "|" + px;
  if (QR_CACHE[key]) return QR_CACHE[key];
  var m = qrMatrix(text, "M");
  if (!m) return '<span class="helper-text">That link is too long for a QR code.</span>';
  var n = m.length, q = 2, span = n + q * 2, rects = "", y, x, w;
  for (y = 0; y < n; y++) {
    x = 0;
    while (x < n) {
      if (m[y][x]) {
        w = 1;
        while (x + w < n && m[y][x + w]) w++;
        rects += '<rect x="' + (x + q) + '" y="' + (y + q) + '" width="' + w + '" height="1"/>';
        x += w;
      } else x++;
    }
  }
  var svg = '<svg viewBox="0 0 ' + span + ' ' + span + '" width="' + px + '" height="' + px +
    '" shape-rendering="crispEdges" role="img" aria-label="' + esc(label || "QR code") + '">' +
    '<rect width="' + span + '" height="' + span + '" fill="#fff"/><g fill="#111">' + rects + '</g></svg>';
  QR_CACHE[key] = svg;
  return svg;
}

/* The three things a code can point at. Only the app link is anonymous; the
   other two name something, so they are built where they are shown rather
   than kept anywhere. */
function appQrHTML(px) { return qrSvgHTML(appUrl(), px, "QR code linking to The Recipe Box"); }
function recipeQrUrl(recipeId) { return appUrl() + "?r=" + encodeURIComponent(recipeId); }
function recipeQrHTML(recipeId, px) {
  return qrSvgHTML(recipeQrUrl(recipeId), px, "QR code linking to this recipe");
}
function friendQrUrl(username) { return appUrl() + "?f=" + encodeURIComponent(username); }
function friendQrHTML(username, px) {
  return qrSvgHTML(friendQrUrl(username), px, "QR code that adds " + username + " as a friend");
}

const TAG_TREE = ${JSON.stringify(TAG_TREE)};
const TAG_MIGRATION = ${JSON.stringify(TAG_MIGRATION)};

/* The three functions below are shared with the server by stringifying them
   into this page. Wrangler bundles the Worker with esbuild, which has
   keepNames on, so it rewrites every function as __name(fn, "fn") to
   preserve the name through minification. That helper is defined at the top
   of the Worker bundle - but toString() carries the calls here, where it
   does not exist, and the whole script dies on the first one.
   Defining a no-op locally costs nothing and makes this page independent of
   how, or whether, the Worker was bundled. */
var __name = function (target) { return target; };
${buildTagIndex.toString()}
const TAG_INDEX = buildTagIndex();
${canonicalTag.toString()}
${canonicalTags.toString()}

/* Does this recipe carry the tag, or anything beneath it? */
function recipeHasTag(r, label) {
  const k = label.toLowerCase();
  const own = r.tags.map(function (t) { return t.toLowerCase(); });
  if (own.indexOf(k) >= 0) return true;
  const kids = TAG_INDEX.kids[k] || [];
  for (let i = 0; i < kids.length; i++) if (own.indexOf(kids[i]) >= 0) return true;
  return false;
}

/* ====================================================================== */
/* Notifications                                                           */
/* ====================================================================== */
/* Worked out from the library rather than kept in a table: every event we
   want to report is already implied by what the server just sent. Only the
   read and cleared marks are ours alone, and those live on the device, keyed
   by username - two people sharing a cookbook read their own post.
   The cost of that choice: read state does not follow you between devices,
   and a cleared item stays cleared only here. */
function notifKey(kind) {
  const who = (state.session && state.session.username) ? state.session.username.toLowerCase() : "";
  return "recipeBoxNotif" + kind + ":" + who;
}
function loadNotifSet(kind) {
  try {
    const raw = localStorage.getItem(notifKey(kind));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveNotifSet(kind, obj) {
  try { localStorage.setItem(notifKey(kind), JSON.stringify(obj)); } catch (e) {}
}

function rawNotifications() {
  if (!state.session) return [];
  const out = [], ours = {};
  const meLc = state.session.username.toLowerCase();

  /* When a friendship is made, everything the other cookbook had already
     shared becomes visible at once. Reporting fifty recipes as fifty separate
     pieces of news is not news, so anything that predates the handshake is
     folded into the handshake itself and only what they add afterwards is
     announced on its own. */
  const since = {}, bundle = {};
  state.friends.forEach(function (f) {
    if (!f.label || !f.since) return;
    since[f.label] = f.since;
    bundle[f.label] = { count: 0, at: f.since };
  });

  state.recipes.forEach(function (r) {
    if (r.ours) { ours[r.recipeId] = r; return; }
    /* A friend has put a recipe somewhere we can see it. */
    if (r.visibility !== "friends") return;
    const cut = since[r.household];
    if (cut && String(r.createdAt || "") <= String(cut)) {
      bundle[r.household].count++;      /* already theirs when we linked up */
      return;
    }
    out.push({
      id: "recipe:" + r.recipeId, kind: "recipe", at: r.createdAt,
      who: r.household, title: r.title, recipeId: r.recipeId
    });
  });

  Object.keys(bundle).forEach(function (label) {
    /* The timestamp is in the id so a cleared handshake stays cleared while
       a genuinely new one with the same friend still gets through. */
    out.push({
      id: "friend:" + label + ":" + bundle[label].at, kind: "friend",
      at: bundle[label].at, who: label, count: bundle[label].count
    });
  });
  /* An invitation waiting on an answer. Only the asking is news: an
     acceptance, a new dish or a cancellation all show on the tile, and
     reporting each of them separately would turn a dinner for six into a
     stream. The id carries the seat's timestamp so being asked again after a
     decline still gets through. */
  state.meals.forEach(function (m) {
    if (m.myStatus !== "invited") return;
    out.push({
      id: "meal:" + m.mealId + ":" + (m.seatAt || ""),
      kind: "meal", at: m.seatAt || m.createdAt,
      who: m.ownerLabel, title: m.title, mealId: m.mealId, when: m.date
    });
  });
  /* The other direction: somebody said yes to a meal we are hosting. Worth
     telling the host about because it is the answer to a question they
     asked, unlike a new dish or a cancellation, which are things the tile
     already shows. Only the host, and only an acceptance - a decline is a
     quiet no, and a host who wants the full count has the guest list. The
     seat's own timestamp is in the id, so being asked again after a decline
     and accepting the second time still gets through. */
  state.meals.forEach(function (m) {
    if (m.myStatus !== "owner") return;
    m.guests.forEach(function (g) {
      if (g.mine || g.status !== "accepted") return;
      out.push({
        id: "mealAccept:" + m.mealId + ":" + g.label + ":" + (g.updatedAt || ""),
        kind: "mealAccept", at: g.updatedAt || m.createdAt,
        who: g.label, title: m.title, mealId: m.mealId, when: m.date
      });
    });
  });

  Object.keys(state.comments).forEach(function (rid) {
    const mine = ours[rid];
    if (!mine) return;                       /* only cooks of our own recipes */
    commentsFor(rid).forEach(function (c) {
      if (String(c.username).toLowerCase() === meLc) return;   /* our own log */
      out.push({
        id: "cook:" + c.commentId, kind: "cook", at: c.createdAt || c.cookedOn,
        who: c.username, title: mine.title, recipeId: rid,
        rating: c.rating, comment: c.comment, cookedOn: c.cookedOn
      });
    });
  });
  return out;
}

function allNotifications() {
  const raw = rawNotifications();
  let read = loadNotifSet("Read");
  /* First run for this username: everything that already happened counts as
     read. Otherwise a new device opens on a wall of old news. */
  if (read === null) {
    read = {};
    raw.forEach(function (n) { read[n.id] = 1; });
    saveNotifSet("Read", read);
  }
  const cleared = loadNotifSet("Cleared") || {};
  return raw
    .filter(function (n) { return !cleared[n.id]; })
    .map(function (n) { n.read = !!read[n.id]; return n; })
    .sort(function (a, b) { return String(b.at || "").localeCompare(String(a.at || "")); });
}
function unreadNotifications() {
  return allNotifications().filter(function (n) { return !n.read; });
}

function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(String(iso).length === 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d.getTime())) return String(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  let rel;
  if (mins < 1) rel = "just now";
  else if (mins < 60) rel = mins + (mins === 1 ? " minute ago" : " minutes ago");
  else if (mins < 1440) { const h = Math.floor(mins / 60); rel = h + (h === 1 ? " hour ago" : " hours ago"); }
  else if (mins < 43200) { const dd = Math.floor(mins / 1440); rel = dd + (dd === 1 ? " day ago" : " days ago"); }
  else rel = "";
  const abs = d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });
  return rel ? rel + " · " + abs : abs;
}

function friendLabels() { return state.friends.map(f => f.label); }
function isMarked(kind, id) { return (state.marks[kind] || []).indexOf(id) >= 0; }

/* Star, save for later, pin. Icon only on a card, worded in full on the
   recipe itself. Pinning your own recipe is meaningless, so it is hidden. */
const MARK_DEFS = [
  ["star", "star", "Favorite", "Favorited"],
  ["later", "clock", "Save for later", "Saved for later"],
  ["pin", "pin", "Pin to my cookbook", "Pinned to my cookbook"]
];
function MarkButtonsHTML(r, full) {
  return MARK_DEFS.map(function (d) {
    if (d[0] === "pin" && r.ours) return "";
    const on = isMarked(d[0], r.recipeId);
    return '<button class="mark mark-' + d[0] + (on ? " on" : "") + '" title="' + d[2] + '" ' +
      'onclick="event.stopPropagation(); Actions.toggleMark(\\'' + d[0] + '\\',\\'' + r.recipeId + '\\')">' +
      icon(d[1], full ? 15 : 14) + (full ? '<span>' + (on ? d[3] : d[2]) + '</span>' : "") +
    '</button>';
  }).join("");
}

/* ---- tab bar ----------------------------------------------------------- */
/* Three places to be, always reachable. Which tab is lit follows the view
   rather than being stored separately, so there is no second copy of "where
   am I" to fall out of step with the first. */
const TABS = [
  ["recipes", "scroll", "Recipes"],
  ["calendar", "calGrid", "Calendar"],
  ["groceries", "checklist", "Groceries"]
];
function activeTab() {
  if (state.view === "calendar") return "calendar";
  if (state.view === "groceries" || state.view === "grocery") return "groceries";
  return "recipes";
}
/* Hidden while editing: the bar is one tap from throwing away a half-written
   recipe, and the Cancel button is right there for leaving on purpose. */
function tabsVisible() {
  return !!state.session && !state.loading && state.view !== "edit" && state.view !== "link";
}
function TabBarHTML() {
  if (!tabsVisible()) return "";
  const cur = activeTab();
  return '<nav class="tabbar">' + TABS.map(function (t) {
    return '<button class="tab' + (t[0] === cur ? " on" : "") + '" ' +
      'aria-current="' + (t[0] === cur ? "page" : "false") + '" ' +
      'onclick="Actions.goTab(\\'' + t[0] + '\\')">' +
      icon(t[1], 21) + '<span>' + t[2] + '</span></button>';
  }).join("") + '</nav>';
}
function renderTabBar() {
  const el = document.getElementById("tabbar-root");
  if (el) el.innerHTML = TabBarHTML();
}

function visibilityPill(r, clickable) {
  const v = r.visibility;
  const label = visibilityLabel(v);
  const glyph = visibilityIcon(v, 12);
  const cls = "pill" + (v === "friends" ? " pill-shared" : v === "selective" ? " pill-select" : "");
  if (!clickable) return '<span class="' + cls + '">' + glyph + " " + label + '</span>';
  return '<button class="' + cls + '" onclick="Actions.openModal(\\'visibility\\')">' + glyph + " " + label + '</button>';
}

function RecipeCardHTML(r) {
  const st = statsFor(r.recipeId);
  const tags = r.tags.slice(0, 3).map(t => '<span class="tag">' + esc(t) + '</span>').join("");
  const badge = r.ours
    ? ((r.owner === state.session.username) ? "" : '<span class="owner-badge">' + esc(r.owner) + '</span>')
    : '<span class="owner-badge">' + esc(r.household) + '</span>';
  return '' +
    '<div class="rcard" role="button" tabindex="0" onclick="Actions.openDetail(\\'' + r.recipeId + '\\')">' +
      '<h3 class="font-display">' + esc(r.title) + '</h3>' +
      (r.description ? '<p class="desc">' + esc(r.description) + '</p>' : "") +
      '<div class="tag-row">' + badge + tags + '</div>' +
      '<div class="card-foot">' + ratingHTML(st.avg, st.count) +
        (st.count ? '<span class="cooked-count">· cooked ' + st.count + '×</span>' : "") +
        '<span class="mark-row">' + MarkButtonsHTML(r, false) + ScheduleMarkHTML(r, false) + '</span>' +
      '</div>' +
    '</div>';
}

/* The same button in both places: a glyph beside the other marks on a card,
   worded in full on the recipe itself. On a card it stands in for the one on
   the recipe - same modal, without the trip through the recipe to reach it. */
function ScheduleMarkHTML(r, full) {
  return '<button class="mark mark-cal" title="Schedule this recipe" ' +
    'onclick="event.stopPropagation(); Actions.openSchedule(\\'' + r.recipeId + '\\')">' +
    icon("calGrid", full ? 15 : 14) + (full ? '<span>Schedule this recipe</span>' : "") +
  '</button>';
}

function tagSort(a, b) {
  const aUpper = /^[A-Z]/.test(a), bUpper = /^[A-Z]/.test(b);
  if (aUpper !== bUpper) return aUpper ? -1 : 1;
  return a.localeCompare(b);
}
/* Category order comes from the taxonomy itself, so the chip row always
   starts with Meal/Dish Type and works down; alphabetical inside each. */
const CAT_ORDER = {};
TAG_TREE.forEach(function (c, i) { CAT_ORDER[c.key] = i; });
function catRank(t) {
  const k = CAT_ORDER[TAG_INDEX.cat[String(t).toLowerCase()]];
  return k === undefined ? 99 : k;
}
function tagOrder(a, b) {
  const ra = catRank(a), rb = catRank(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b);
}
/* Every tag carried by the recipes still on screen, minus the ones already
   chosen. Selecting one of these narrows the list further; it can never
   empty it, because each of these tags is on at least one visible recipe. */
function suggestedTags(results, selected) {
  const skip = {};
  selected.forEach(function (t) { skip[String(t).toLowerCase()] = 1; });
  const out = [];
  results.forEach(function (r) {
    (r.tags || []).forEach(function (raw) {
      const label = canonicalTag(raw) || raw;
      const k = String(label).toLowerCase();
      if (skip[k]) return;
      skip[k] = 1;
      out.push(label);
    });
  });
  return out.sort(tagOrder);
}
function ownerFiltered() {
  if (state.ownerFilter === "ours") return state.recipes.filter(r => r.ours || isMarked("pin", r.recipeId));
  if (state.ownerFilter === "star" || state.ownerFilter === "later") {
    return state.recipes.filter(r => isMarked(state.ownerFilter, r.recipeId));
  }
  if (state.ownerFilter !== "all") return state.recipes.filter(r => r.household === state.ownerFilter);
  return state.recipes;
}
/* Every selected tag must be present. A dish that suits breakfast and
   dinner carries both tags, so narrowing never loses it. */
function matchesTags(r) {
  return state.activeTags.every(function (t) { return recipeHasTag(r, t); });
}
function filteredRecipes() {
  const q = state.search.trim().toLowerCase();
  const list = ownerFiltered().filter(r => {
    if (!matchesTags(r)) return false;
    if (!q) return true;
    const hay = [r.title, r.description, r.owner, r.household].concat(r.tags, r.ingredients.map(i => i.name)).join(" ").toLowerCase();
    return hay.includes(q);
  });
  return sortRecipes(list);
}
function sortRecipes(list) {
  const arr = list.slice();
  const s = state.sort;
  if (s === "az") arr.sort((a, b) => a.title.localeCompare(b.title));
  else if (s === "za") arr.sort((a, b) => b.title.localeCompare(a.title));
  else if (s === "oldest") arr.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  else if (s === "cooked") arr.sort((a, b) => {
    const A = statsFor(a.recipeId), B = statsFor(b.recipeId);
    return (B.count - A.count) || ((B.avg || 0) - (A.avg || 0)) || a.title.localeCompare(b.title);
  });
  else if (s === "rated") arr.sort((a, b) => {
    const A = statsFor(a.recipeId), B = statsFor(b.recipeId);
    return ((B.avg || 0) - (A.avg || 0)) || (B.count - A.count) || a.title.localeCompare(b.title);
  });
  else arr.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return arr;
}
function hasActiveFilter() {
  return !!(state.search.trim() || state.activeTags.length || state.ownerFilter !== "all");
}

function ResultsSectionHTML() {
  const results = filteredRecipes();
  const picked = state.activeTags.slice().sort(tagOrder);
  const offered = suggestedTags(results, state.activeTags);
  state._tagList = picked.concat(offered);
  let chips = state._tagList.map((t, i) =>
    '<span class="chip' + (i < picked.length ? " active" : "") + '" onclick="Actions.toggleTagAt(' + i + ')">' +
      esc(t) + '</span>'
  ).join("");
  if (picked.length > 1) chips += '<span class="chip chip-clear" onclick="Actions.clearFilters()">Clear all</span>';
  let body;
  if (results.length === 0) {
    body = state.recipes.length === 0
      ? '<div class="empty-state"><p class="title font-display">Your recipe box is empty</p>' +
        '<p class="sub">Add your first recipe, import a file, or add a friend to see theirs.</p>' +
        '<div class="empty-actions"><button class="btn btn-primary" onclick="Actions.openNew()">Add a recipe</button>' +
        '<button class="btn" onclick="Actions.openModal(\\'import\\')">Import a file</button></div></div>'
      : '<div class="empty-state"><p class="title font-display">Nothing matches</p>' +
        '<p class="sub">Try a different search, or clear the tag and cook filters.</p>' +
        (state.ownerFilter !== "all"
          ? '<div class="empty-actions"><button class="btn" onclick="Actions.setOwnerFilter(\\'all\\')">' +
            icon("users", 15) + ' Show everyone\\'s recipes</button></div>'
          : "") + '</div>';
  } else {
    body = '<div class="grid-recipes">' + results.map(RecipeCardHTML).join("") + '</div>';
  }
  return (state._tagList.length ? '<div class="chips">' + chips + '</div>' : "") + body;
}

function LibraryViewHTML() {
  const alerts = state.incoming.length + unreadNotifications().length;
  const sortOptions = [["newest", "Newest first"], ["oldest", "Oldest first"], ["cooked", "Most cooked"],
    ["rated", "Highest rated"], ["az", "Title A–Z"], ["za", "Title Z–A"]]
    .map(o => '<option value="' + o[0] + '"' + (state.sort === o[0] ? " selected" : "") + '>' + o[1] + '</option>').join("");
  return '' +
    '<div class="wrap">' +
      '<div class="header">' +
        '<div class="header-brand">' +
          '<img class="app-icon" src="/icon.png" alt="" />' +
          '<h1 class="font-display">The Recipe Box</h1>' +
        '</div>' +
        '<div class="header-row2">' +
          '<p class="header-who"><b>' + esc(state.session.username) + '</b> · ' +
            state.recipes.length + ' recipe' + (state.recipes.length === 1 ? "" : "s") + ' on the shelf</p>' +
          '<div class="header-btns">' +
            '<button class="btn bell" title="Friends and notifications" onclick="Actions.openFriends()">' + icon("users", 16) +
              (alerts ? '<span class="dot-badge">' + alerts + '</span>' : "") + '</button>' +
            '<button class="btn" onclick="Actions.openModal(\\'actions\\')">Actions</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="search-wrap">' +
        '<div class="search-field"><span class="icon">' + icon("search", 18) + '</span>' +
          '<input id="search-input" type="text" placeholder="Search recipes, ingredients, tags..." value="' + esc(state.search) + '" oninput="Actions.onSearchInput(this.value)" />' +
          '<button id="search-clear" class="search-clear' + (state.search ? " on" : "") + '" title="Clear search" onclick="Actions.clearSearch()">' + icon("x", 15) + '</button>' +
        '</div>' +
        '<button id="filter-btn" class="btn search-filter' + (state.activeTags.length ? " on" : "") + '" onclick="Actions.openFilters()">' +
          FilterButtonInnerHTML() +
        '</button></div>' +
      '<div class="filter-row">' +
        '<button class="btn owner-pick" onclick="Actions.openModal(\\'owner\\')">' +
          icon("users", 14) + ' ' + esc(ownerFilterLabel()) + '</button>' +
        '<select onchange="Actions.setSort(this.value)">' + sortOptions + '</select>' +
      '</div>' +
      '<div id="results-section">' + ResultsSectionHTML() + '</div>' +
    '</div>';
}
function FilterButtonInnerHTML() {
  return icon("sliders", 16) +
    (state.activeTags.length ? ' <span class="fcount">' + state.activeTags.length + '</span>' : "");
}
function updateResultsSection() {
  const el = document.getElementById("results-section");
  if (el) el.innerHTML = ResultsSectionHTML();
}
/* The tag count lives outside the results block, so it needs its own nudge -
   otherwise the button keeps claiming filters that are no longer set. */
function updateFilterButton() {
  const el = document.getElementById("filter-btn");
  if (!el) return;
  el.className = "btn search-filter" + (state.activeTags.length ? " on" : "");
  el.innerHTML = FilterButtonInnerHTML();
}
function updateSearchClear() {
  const el = document.getElementById("search-clear");
  if (el) el.classList.toggle("on", !!state.search);
}
function updateLibraryChrome() { updateResultsSection(); updateFilterButton(); updateSearchClear(); }

/* ====================================================================== */
/* Render: Groceries                                                       */
/* ====================================================================== */
/* Pick the days you are shopping for, and everything scheduled inside them
   is added up into a list. The list is a snapshot on purpose: once you are
   standing in the shop, the calendar changing under you would be a hazard,
   not a feature. */
function GroceriesViewHTML() {
  const rng = state.groceryRange;
  const ready = !!(rng.start && rng.end && rng.start <= rng.end);
  const badOrder = !!(rng.start && rng.end && rng.start > rng.end);
  const lists = state.groceryLists.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const index = lists.length === 0
    ? '<div class="empty-state"><p class="title font-display">No shopping lists yet</p>' +
      '<p class="sub">Pick the first and last day you are shopping for above, and everything on the ' +
      'calendar between them gets added up into a list.</p></div>'
    : '<ul class="groc-list">' + lists.map(function (L) {
        return '<li class="groc-entry">' +
          '<span style="color:var(--accent);flex-shrink:0">' + icon("checklist", 17) + '</span>' +
          '<button class="groc-entry-main" onclick="Actions.openGroceryList(\\'' + L.listId + '\\')">' +
            '<div class="groc-entry-label">' + esc(L.label) + '</div>' +
            '<div class="groc-entry-sub">' + (L.itemCount || 0) + ' item' +
              ((L.itemCount || 0) === 1 ? "" : "s") + '</div>' +
          '</button>' +
          '<button class="icon-btn" title="Rename this list" ' +
            'onclick="Actions.openRenameList(\\'' + L.listId + '\\')">' + icon("pencil", 15) + '</button>' +
          '<button class="icon-btn" title="Delete this list" ' +
            'onclick="Actions.deleteGroceryList(\\'' + L.listId + '\\')">' + icon("x", 16) + '</button>' +
        '</li>';
      }).join("") + '</ul>';
  return '' +
    '<div class="wrap">' +
      '<div class="detail-top">' +
        '<h1 class="detail-title font-display" style="margin:0">Groceries</h1>' +
        '<div class="detail-tools">' +
          '<button class="btn btn-sm" title="Staples left off every new list" ' +
            'onclick="Actions.openExclusions()">' + icon("checklist", 14) + ' Staples</button>' +
          '<button class="icon-btn" title="How groceries work" ' +
            'onclick="Actions.openModal(\\'groceriesHelp\\')">' + icon("info", 17) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="groc-range">' +
        '<div class="field"><label>First day</label>' +
          '<input type="date" id="groc-start" value="' + esc(rng.start) + '" ' +
          (rng.end ? 'max="' + esc(rng.end) + '" ' : "") +
          'onchange="Actions.setGroceryRange(\\'start\\', this.value)" /></div>' +
        '<div class="field"><label>Last day</label>' +
          '<input type="date" id="groc-end" value="' + esc(rng.end) + '" ' +
          (rng.start ? 'min="' + esc(rng.start) + '" ' : "") +
          'onchange="Actions.setGroceryRange(\\'end\\', this.value)" /></div>' +
        '<button class="btn btn-primary" ' + (ready ? "" : "disabled ") +
          'onclick="Actions.createGroceryList()">' + icon("plus", 15) + ' Build list</button>' +
      '</div>' +
      (badOrder ? '<div class="modal-error">The last day is before the first one.</div>' : "") +
      index +
    '</div>';
}

/* One shopping line, collapsed. The tick is for the shop; the name and the
   quantity chip both open the editor below, which is where the source recipe,
   the two unit fields and this line's own actions live; the dots reorder to
   match the aisles. Everything that used to stack vertically inside the row
   now lives one tap away, which is what gets the row down to a single line. */
function GroceryRowHTML(L, item, merging) {
  const gone = !!item.removed;
  const isSrc = merging && state.groceryMergeFrom === item.id;
  /* A line you have set aside is not a thing to merge into. */
  const isTarget = merging && !isSrc && !gone;
  const open = state.groceryOpenId === item.id;
  const cls = "groc-row" + (item.checked && !gone ? " groc-done" : "") + (gone ? " groc-gone" : "") +
    (isSrc ? " merge-src" : "") + (isTarget ? " merge-target" : "") +
    (state.grocerySwipedId === item.id ? " swiped" : "");
  const rowClick = isTarget
    ? ' onclick="Actions.completeGroceryMerge(\\'' + L + '\\',\\'' + item.id + '\\')"'
    : "";
  /* The tick is inert on a line that is not being bought. */
  const tick = (gone || merging)
    ? '<span class="groc-tick" aria-hidden="true"></span>'
    : '<button class="groc-tick' + (item.checked ? " on" : "") + '" ' +
        'aria-pressed="' + (item.checked ? "true" : "false") + '" ' +
        'onclick="event.stopPropagation(); Actions.toggleGroceryCheck(\\'' + L + '\\',\\'' + item.id + '\\')">' +
        (item.checked ? icon("check", 14) : "") + '</button>';
  /* While a merge is being aimed, every tap on a candidate line means "this
     one" - the editor would otherwise swallow the tap and there would be no
     way left to pick a target. So the row's own handlers are replaced for
     the duration rather than competing with the one on the <li>. */
  const pick = 'Actions.completeGroceryMerge(\\'' + L + '\\',\\'' + item.id + '\\')';
  /* Both units in the one chip, exactly as the line reads. A line with no
     quantity at all still gets a chip, because that is the way in to giving
     it one. */
  const chip = '<button class="groc-qty-chip" title="' +
    (isTarget ? 'Merge into this line' : 'Change the amount') + '" ' +
    'onclick="event.stopPropagation(); ' +
    (isTarget ? pick : 'Actions.openGroceryRow(\\'' + L + '\\',\\'' + item.id + '\\',\\'qty\\')') +
    '">' + esc(qtyText(item) || "—") + '</button>';
  /* Parked under the row, revealed by dragging it left. The set-aside x that
     used to sit on every row cost horizontal space on all seventeen of them
     to be useful on about two, so it moved here. */
  const back = gone
    ? '<div class="groc-swipe-back"><button class="put-back" ' +
        'onclick="event.stopPropagation(); Actions.restoreGroceryItem(\\'' + L + '\\',\\'' + item.id + '\\')">' +
        icon("undo", 14) + ' Put back</button></div>'
    : '<div class="groc-swipe-back"><button ' +
        'onclick="event.stopPropagation(); Actions.removeGroceryItem(\\'' + L + '\\',\\'' + item.id + '\\')">' +
        icon("x", 14) + ' Remove</button></div>';
  const row = '<li class="' + cls + '" data-id="' + item.id + '"' + rowClick + '>' +
    back +
    '<div class="groc-slide"' +
      (merging ? "" : ' onpointerdown="Actions.swipeDown(event,\\'' + L + '\\',\\'' + item.id + '\\')"') + '>' +
      tick +
      '<button class="groc-name" title="' + (isTarget ? 'Merge into this line' : 'Edit this line') + '" ' +
        'onclick="event.stopPropagation(); ' +
        (isTarget ? pick : 'Actions.openGroceryRow(\\'' + L + '\\',\\'' + item.id + '\\',\\'name\\')') +
        '">' + esc(item.name) + '</button>' +
      chip +
      '<span class="groc-grip" title="Drag to reorder" ' +
        'onpointerdown="Actions.gripDown(event,\\'' + L + '\\',\\'' + item.id + '\\')">' +
        icon("grip", 16) + '</span>' +
    '</div>' +
  '</li>';
  return row + (open ? GroceryEditHTML(L, item) : "");
}

/* The editor for one line. Renaming here changes this list and nothing else -
   the recipe keeps its own wording, so next week's list comes back saying
   what the recipe says. That is deliberate: "Onion, red" is how a shop is
   laid out, not how a recipe is written. */
function GroceryEditHTML(L, item) {
  const gone = !!item.removed;
  /* A hand-added line can have no quantity at all. It still gets one empty
     pair of fields, otherwise there is no way to give it one. */
  const segs = (item.qty && item.qty.length) ? item.qty : [{ mv: null, mu: "", cv: null, cu: "" }];
  const fields = segs.map(function (s, si) {
    const metric = '<input type="number" step="any" min="0" ' + (gone ? "disabled " : "") +
      'id="groc-m-' + item.id + '-' + si + '" value="' + (s.mv == null ? "" : s.mv) + '" ' +
      'aria-label="Metric amount for ' + esc(item.name) + '" ' +
      'onchange="Actions.setGroceryQty(\\'' + L + '\\',\\'' + item.id + '\\',' + si + ',\\'m\\',this.value)" />' +
      (s.mu ? '<span class="groc-unit">' + esc(s.mu) + '</span>' : "");
    /* Only where the line actually carries a second unit. There is no
       conversion table behind these two numbers - they are the pair the
       recipe stated - so a customary field on a line that never had one
       would be a number with nothing to be proportional to. */
    const cust = (s.cv == null && !s.cu) ? "" :
      '<input type="number" step="any" min="0" ' + (gone ? "disabled " : "") +
      'id="groc-c-' + item.id + '-' + si + '" value="' + (s.cv == null ? "" : s.cv) + '" ' +
      'aria-label="Customary amount for ' + esc(item.name) + '" ' +
      'onchange="Actions.setGroceryQty(\\'' + L + '\\',\\'' + item.id + '\\',' + si + ',\\'c\\',this.value)" />' +
      (s.cu ? '<span class="groc-unit">' + esc(s.cu) + '</span>' : "");
    return (si ? '<span class="groc-plus">+</span>' : "") + metric + cust;
  }).join("");
  const acts = gone
    ? '<button class="btn btn-sm" onclick="Actions.restoreGroceryItem(\\'' + L + '\\',\\'' + item.id + '\\')">' +
        icon("undo", 14) + ' Put back</button>' +
      '<button class="btn btn-sm" onclick="Actions.purgeGroceryItem(\\'' + L + '\\',\\'' + item.id + '\\')">' +
        icon("trash", 14) + ' Delete for good</button>'
    : '<button class="btn btn-sm" onclick="Actions.removeGroceryItem(\\'' + L + '\\',\\'' + item.id + '\\')">' +
        icon("x", 14) + ' Remove from list</button>' +
      '<button class="btn btn-sm" onclick="Actions.beginGroceryMerge(\\'' + item.id + '\\')">' +
        icon("merge", 14) + ' Merge into…</button>' +
      '<button class="btn btn-sm" style="margin-left:auto" onclick="Actions.closeGroceryRow()">Done</button>';
  return '<li class="groc-edit">' +
    '<input class="groc-name-input" id="groc-name-' + item.id + '" ' + (gone ? "disabled " : "") +
      'value="' + esc(item.name) + '" maxlength="120" aria-label="Name of this line" ' +
      'onchange="Actions.setGroceryName(\\'' + L + '\\',\\'' + item.id + '\\',this.value)" />' +
    ((item.from && item.from.length)
      ? '<p class="groc-from">For ' + esc(item.from.join(", ")) + '</p>'
      : '<p class="groc-from">Added by hand</p>') +
    '<div class="groc-qty">' + fields + '</div>' +
    '<div class="groc-edit-acts">' + acts + '</div>' +
  '</li>';
}

function GroceryListViewHTML() {
  const L = state.activeListId;
  const meta = state.groceryLists.filter(x => x.listId === L)[0];
  const items = groceryItemsFor(L);
  const merging = !!state.groceryMergeFrom;
  const src = merging ? items.filter(i => i.id === state.groceryMergeFrom)[0] : null;
  const live = items.filter(i => !i.removed);
  const got = live.filter(i => i.checked).length;
  const gone = items.length - live.length;
  const hint = merging
    ? '<div class="groc-merge-hint">' + icon("merge", 15) +
        '<span>Pick the line to merge <b>' + esc(src ? src.name : "") + '</b> into. The quantities add up ' +
        'and the name you pick is the one that stays.</span>' +
        '<button class="btn btn-sm" style="margin-left:auto" onclick="Actions.cancelGroceryMerge()">Cancel</button>' +
      '</div>'
    : "";
  /* Rendered in stored order, which normalizeGroceryOrder keeps banded: still
     to get, then in the basket, then removed. The last two collapse behind a
     heading, because both are things you have already dealt with and neither
     earns its height while you are still shopping.
     The headings are not .groc-row elements and the bands stay in stored
     order, so the drag maths steps straight over them and an index read off
     the rendered rows still means what it means in the array. */
  const toGet = items.filter(function (i) { return !i.removed && !i.checked; });
  const inBasket = items.filter(function (i) { return !i.removed && i.checked; });
  const takenOff = items.filter(function (i) { return i.removed; });
  const section = function (key, label, group) {
    if (!group.length) return "";
    const open = !!state.grocerySections[key];
    return '<li class="groc-sep">' +
        '<button class="groc-sec' + (open ? " open" : "") + '" ' +
          'aria-expanded="' + (open ? "true" : "false") + '" ' +
          'onclick="Actions.toggleGrocerySection(\\'' + key + '\\')">' +
          esc(label) + ' <span class="groc-sec-n">' + group.length + '</span>' +
          icon("chevronDown", 14) +
        '</button>' +
      '</li>' +
      (open ? group.map(function (i) { return GroceryRowHTML(L, i, merging); }).join("") : "");
  };
  let body;
  if (items.length === 0) {
    body = '<div class="empty-state"><p class="title font-display">Nothing on this list</p>' +
      '<p class="sub">Either nothing was scheduled for those days, or you have taken everything off.</p></div>';
  } else {
    body = '<ul class="groc-lines" id="groc-items">' +
      toGet.map(function (i) { return GroceryRowHTML(L, i, merging); }).join("") +
      section("basket", "In the basket", inBasket) +
      section("removed", "Removed from list", takenOff) +
      '</ul>';
  }
  return '' +
    '<div class="wrap">' +
      '<div class="groc-bar">' +
        '<button class="groc-bar-back" title="Back to the lists" ' +
          'onclick="Actions.backToGroceries()">' + icon("chevronLeft", 20) + '</button>' +
        '<button class="groc-bar-title" title="Rename this list" ' +
          'onclick="Actions.openRenameList(\\'' + L + '\\')">' +
          '<span class="lbl">' + esc(meta ? meta.label : "Shopping list") + '</span>' +
          '<span class="cnt">' + got + '/' + live.length + '</span>' +
        '</button>' +
        '<button class="icon-btn" title="How this list works" ' +
          'onclick="Actions.openModal(\\'groceryHelp\\')">' + icon("info", 17) + '</button>' +
      '</div>' +
      (items.length > 1
        ? '<button class="btn btn-sm groc-tidy" onclick="Actions.openMergeCommon()">' +
            icon("merge", 14) + ' Merge common ingredients</button>'
        : "") +
      hint +
      body +
      '<button class="btn groc-add" onclick="Actions.openAddGroceryItem()">' + icon("plus", 15) +
        ' Add an item</button>' +
    '</div>';
}

/* ====================================================================== */
/* Render: Calendar                                                        */
/* ====================================================================== */
/* Three weeks on screen, more above and below. Rather than virtualising the
   scroll, a generous window of real weeks is rendered into a box exactly
   three rows tall and the box is scrolled to put this week in the middle;
   reaching either edge widens the window by six weeks and holds the scroll
   position where it was. It is a page of a wall calendar either way, and the
   version without the bookkeeping cannot lose its place. */
const CAL_CELL_H = 92, CAL_GAP = 3, CAL_ROW = CAL_CELL_H + CAL_GAP;
const CAL_CHIP_MAX = 3;

function calWeekStarts() {
  const first = addDays(sundayOf(localToday()), -7 * state.calBack);
  const weeks = [];
  for (let i = 0; i < state.calBack + 1 + state.calFwd; i++) weeks.push(addDays(first, 7 * i));
  return weeks;
}

function CalCellHTML(key, today, mealEntries) {
  const d = fromYmd(key);
  const entries = scheduleOn(key);
  const shown = entries.slice(0, CAL_CHIP_MAX);
  const chips = shown.map(function (e) {
    /* Blue means this one is a dish you agreed to bring to a community meal.
       It reaches the shopping list like any other booking - the colour is
       only there to say where the commitment came from. */
    const forMeal = !!(mealEntries && mealEntries[e.entryId]);
    const live = !!recipeById(e.recipeId);
    const label = live ? (recipeById(e.recipeId).title) : e.title;
    return '<button class="cal-chip' + (live ? "" : " cal-chip-orphan") +
      (forMeal ? " cal-chip-meal" : "") + '" ' +
      'title="' + esc(label) + ' · ' + esc(String(e.servings)) +
        (forMeal ? ' · Community Meal' : "") + '" ' +
      'onclick="event.stopPropagation(); Actions.openScheduled(\\'' + e.entryId + '\\')">' +
      esc(label) + '</button>';
  }).join("");
  const more = entries.length > CAL_CHIP_MAX
    ? '<div class="cal-more">+' + (entries.length - CAL_CHIP_MAX) + ' more</div>' : "";
  const cls = "cal-cell" + (key === today ? " cal-today" : "") +
    (d.getMonth() !== fromYmd(today).getMonth() ? " cal-dim" : "");
  return '<div class="' + cls + '" role="button" tabindex="0" ' +
    'aria-label="' + esc(shortDate(key)) + '" ' +
    'onclick="Actions.openCalDay(\\'' + key + '\\')">' +
    '<div class="cal-num"><span>' + d.getDate() + '</span>' +
      (d.getDate() === 1 ? '<span class="cal-mon">' + MON[d.getMonth()] + '</span>' : "") + '</div>' +
    '<div class="cal-chips">' + chips + '</div>' + more +
  '</div>';
}

function CalendarViewHTML() {
  const today = localToday();
  const head = DOW.map(n => '<div>' + n + '</div>').join("");
  let cells = "";
  /* Worked out once for the whole grid rather than per square: it is a walk
     over every dish on every meal, and there are a few hundred squares. */
  const mealEntries = mealEntryIds();
  calWeekStarts().forEach(function (ws) {
    for (let i = 0; i < 7; i++) cells += CalCellHTML(addDays(ws, i), today, mealEntries);
  });
  const planned = weekScheduledCount();
  return '' +
    '<div class="wrap">' +
      '<div class="detail-top">' +
        '<h1 class="detail-title font-display" style="margin:0">Calendar</h1>' +
        '<div class="detail-tools">' +
          '<button class="btn btn-sm" onclick="Actions.calToday()">Today</button>' +
          '<button class="icon-btn" title="How the calendar works" ' +
            'onclick="Actions.openModal(\\'calendarHelp\\')">' + icon("info", 17) + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="section-label">Personal Calendar</div>' +
      '<div class="cal-head">' + head + '</div>' +
      '<div class="cal-scroll" id="cal-scroll" onscroll="Actions.onCalScroll(this)">' +
        '<div class="cal-grid">' + cells + '</div>' +
      '</div>' +
      '<div class="cal-tools">' +
        '<span class="helper-text" style="margin:0">' +
          (planned
            ? planned + ' recipe' + (planned === 1 ? "" : "s") + ' scheduled this week'
            : "Nothing scheduled this week") +
        '</span>' +
      '</div>' +
      CommunityMealsSectionHTML() +
    '</div>';
}

/* ---- community meals ---------------------------------------------------
   Rendered below the grid rather than in it. A tile is a week wide because
   everything it has to say - who is coming, what they are bringing, and the
   box where you say what you are - is a list, and a list does not fit in a
   day square. */
function mealWhen(m) {
  const day = shortDate(m.date);
  if (!m.time) return day;
  const h = parseInt(m.time.slice(0, 2), 10), mm = m.time.slice(3);
  const ampm = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return day + " at " + h12 + (mm === "00" ? "" : ":" + mm) + ampm;
}

function MealGuestsHTML(m) {
  const canManage = m.myStatus === "owner";
  return '<div class="meal-guests">' + m.guests.map(function (g) {
    const settled = g.status === "owner" || g.status === "accepted";
    const cls = "meal-guest" + (settled ? " on" : " waiting");
    /* Only somebody who has not answered can be withdrawn. Once they have
       accepted they are a guest, and a guest leaves under their own steam. */
    const drop = (canManage && g.status === "invited")
      ? '<button title="Un-invite" onclick="Actions.uninviteGuest(\\'' + m.mealId + '\\',\\'' +
          esc(g.label) + '\\')">' + icon("x", 13) + '</button>'
      : "";
    const mark = g.status === "owner" ? " (host)" : g.status === "invited" ? " — not answered" : "";
    return '<span class="' + cls + '">' + (settled ? icon("check", 12) : "") +
      esc(g.label) + esc(mark) + drop + '</span>';
  }).join("") + '</div>';
}

function MealDishesHTML(m) {
  if (!m.dishes.length) return '<p class="meal-none">Nobody has said what they are bringing yet.</p>';
  const counts = dishTitleCounts(m);
  return '<ul class="meal-dishes">' + m.dishes.map(function (d) {
    const dup = counts[String(d.title).trim().toLowerCase()] > 1;
    return '<li class="meal-dish">' +
      '<span class="what">' + esc(dishDisplayTitle(m, d, counts)) + '</span>' +
      (dup ? '<span class="lots">×' + counts[String(d.title).trim().toLowerCase()] + '</span>' : "") +
      /* Cook and remove in one box, so the x cannot end up on a line of its
         own underneath the name it belongs to. */
      '<span class="meal-dish-who">' + esc(d.label) +
        (d.mine ? '<button class="icon-btn" title="Take this off" onclick="Actions.removeMealDish(\\'' +
          m.mealId + '\\',\\'' + d.dishId + '\\')">' + icon("x", 13) + '</button>' : "") +
      '</span>' +
    '</li>';
  }).join("") + '</ul>';
}

/* The sign-up box. Picking a recipe does not commit you to it - it opens a
   row underneath asking how much you are making, because that number is what
   reaches the shopping list and guessing it on your behalf would put the
   wrong quantity of everything in the basket. */
const MEAL_RESULT_MAX = 6;

/* Split out from the picker so typing can replace just this block. Redrawing
   the page on every keystroke would take the focus out of the field. */
function MealDishResultsHTML(m) {
  const q = String(state.mealDishSearch[m.mealId] || "");
  const picked = state.mealDishPick[m.mealId] || null;
  if (picked) {
    const r = recipeById(picked.recipeId);
    const counts = dishTitleCounts(m);
    const clash = counts[String(picked.title).trim().toLowerCase()] > 0;
    return (clash
      ? '<div class="meal-dup">Somebody is already bringing ' + esc(picked.title) +
          '. Add it anyway and the tile will read <b>Lots of ' + esc(picked.title) + '</b>.</div>'
      : "") +
      '<div class="meal-dish-pick">' +
        '<span class="name">' + esc(picked.title) + '</span>' +
        '<input type="number" step="any" min="0" id="meal-serv-' + m.mealId + '" ' +
          'aria-label="How many ' + esc(r ? r.servings.unit : "servings") + '" ' +
          'value="' + esc(String(picked.servings)) + '" />' +
        '<span class="unit">' + esc(r ? r.servings.unit : "servings") + '</span>' +
        '<button class="btn btn-sm btn-meal" onclick="Actions.addMealDish(\\'' + m.mealId + '\\')">' +
          icon("plus", 14) + ' Add</button>' +
        '<button class="icon-btn" title="Pick something else" ' +
          'onclick="Actions.clearMealDishPick(\\'' + m.mealId + '\\')">' + icon("x", 15) + '</button>' +
      '</div>';
  }
  if (!q.trim()) return "";
  const all = mealDishMatches(q);
  if (all.length === 0) return '<p class="no-rating">Nothing matches "' + esc(q.trim()) + '".</p>';
  return '<ul class="groc-list">' + all.slice(0, MEAL_RESULT_MAX).map(function (r) {
      /* The plus is the part of the row that looks like the button, so it is
         wired to the same thing the rest of the row does rather than being a
         decoration you can tap all day without effect. */
      return '<li class="groc-entry">' +
        '<button class="groc-entry-main" onclick="Actions.pickMealDish(\\'' + m.mealId +
          '\\',\\'' + r.recipeId + '\\')">' +
          '<div class="groc-entry-label">' + esc(r.title) + '</div>' +
          '<div class="groc-entry-sub">' + esc(r.household) + '</div>' +
        '</button>' +
        '<button class="groc-entry-plus" aria-label="Bring ' + esc(r.title) + '" ' +
          'onclick="Actions.pickMealDish(\\'' + m.mealId + '\\',\\'' + r.recipeId + '\\')">' +
          icon("plus", 16) + '</button>' +
      '</li>';
    }).join("") + '</ul>' +
    (all.length > MEAL_RESULT_MAX
      ? '<p class="no-rating">' + (all.length - MEAL_RESULT_MAX) + ' more — keep typing.</p>' : "");
}

/* The sign-up box. Picking a recipe does not commit you to it - it opens a
   row underneath asking how much you are making, because that number is what
   reaches the shopping list and guessing it on your behalf would put the
   wrong quantity of everything in the basket. */
function MealDishPickerHTML(m) {
  const q = String(state.mealDishSearch[m.mealId] || "");
  return '<div class="meal-sec">What you are bringing</div>' +
    '<div class="search-wrap">' +
      '<div class="search-field"><span class="icon">' + icon("search", 18) + '</span>' +
        '<input id="meal-search-' + m.mealId + '" type="text" ' +
          'placeholder="Search everyone\\'s recipes..." value="' + esc(q) + '" ' +
          'onfocus="Actions.focusMealSearch(\\'meal-search-' + m.mealId + '\\')" ' +
          'oninput="Actions.onMealDishInput(\\'' + m.mealId + '\\', this.value)" />' +
      '</div>' +
    '</div>' +
    '<div id="meal-results-' + m.mealId + '">' + MealDishResultsHTML(m) + '</div>';
}

/* Same box the calendar's own day sheet searches: everything visible, never
   what the Recipes tab happens to be filtered to. */
function mealDishMatches(q) {
  const needle = String(q).trim().toLowerCase();
  if (!needle) return [];
  return state.recipes.filter(function (r) {
    const hay = [r.title, r.description, r.owner, r.household]
      .concat(r.tags, r.ingredients.map(i => i.name)).join(" ").toLowerCase();
    return hay.indexOf(needle) >= 0;
  });
}

function MealTileHTML(m) {
  const invited = m.myStatus === "invited";
  const owner = m.myStatus === "owner";
  const cls = "meal-tile" + (owner ? " meal-mine" : "") +
    (state.mealFocus === m.mealId ? " meal-focus" : "");
  const head =
    '<div class="meal-head">' +
      '<div class="meal-title">' + icon("users", 16) + esc(m.title) + '</div>' +
      '<div class="meal-when">' + esc(mealWhen(m)) + '</div>' +
      '<div class="meal-host">Hosted by ' + esc(m.ownerLabel) +
        (owner ? " — that's you" : "") + '</div>' +
      /* Neither of these is required of a meal, so neither leaves a gap when
         the host had nothing to say or everybody already knows the address. */
      (m.location ? '<div class="meal-where">' + icon("mapPin", 13) + '<span>' + esc(m.location) + '</span></div>' : "") +
      (m.description ? '<p class="meal-note">' + esc(m.description) + '</p>' : "") +
    '</div>';
  /* An invitation is a question, so the tile asks it before it shows the
     sign-up box. You cannot put a dish on a table you have not said yes to. */
  const ask = invited
    ? '<div class="meal-invite">' +
        '<span class="grow">' + esc(m.ownerLabel) + ' has invited you.</span>' +
        '<div class="meal-invite-acts">' +
          '<button class="btn btn-sm btn-meal" onclick="Actions.respondMeal(\\'' + m.mealId + '\\',\\'accept\\')">' +
            icon("check", 14) + ' Accept</button>' +
          '<button class="btn btn-sm btn-ghost" onclick="Actions.respondMeal(\\'' + m.mealId + '\\',\\'decline\\')">' +
            icon("x", 14) + ' Decline</button>' +
        '</div>' +
      '</div>'
    : "";
  const actions = '<div class="meal-actions">' +
    (owner
      ? '<button class="btn btn-sm" onclick="Actions.openMealGuests(\\'' + m.mealId + '\\')">' +
          icon("userPlus", 14) + ' Invite more</button>' +
        '<button class="btn btn-sm" onclick="Actions.openEditMeal(\\'' + m.mealId + '\\')">' +
          icon("pencil", 14) + ' Edit</button>' +
        '<button class="btn btn-sm btn-no" onclick="Actions.cancelMeal(\\'' + m.mealId + '\\')">' +
          icon("trash", 14) + ' Cancel meal</button>'
      : '<button class="btn btn-sm btn-ghost" onclick="Actions.leaveMeal(\\'' + m.mealId + '\\')">' +
          icon("x", 14) + ' Leave</button>') +
    '</div>';
  return '<div class="' + cls + '" id="meal-' + m.mealId + '">' +
    head +
    '<div class="meal-body">' +
      ask +
      '<div class="meal-sec">Who is coming</div>' +
      MealGuestsHTML(m) +
      '<div class="meal-sec">On the table</div>' +
      MealDishesHTML(m) +
      (invited ? "" : MealDishPickerHTML(m)) +
      actions +
    '</div>' +
  '</div>';
}

/* Already eaten. One line, and the whole tile behind it if you want it. */
function MealPastTileHTML(m) {
  const open = !!state.mealPastOpen[m.mealId];
  const counts = m.dishes.length;
  return '<div class="meal-tile meal-past" id="meal-' + m.mealId + '">' +
    '<button class="meal-past-head" aria-expanded="' + (open ? "true" : "false") + '" ' +
      'onclick="Actions.toggleMealPast(\\'' + m.mealId + '\\')">' +
      icon("chevronDown", 14) +
      '<span>' + esc(m.title) + ' — ' + counts + ' dish' + (counts === 1 ? "" : "es") + '</span>' +
      '<span class="when">' + esc(shortDate(m.date)) + '</span>' +
    '</button>' +
    (open
      ? '<div class="meal-body">' +
          '<div class="meal-sec">Who came</div>' + MealGuestsHTML(m) +
          '<div class="meal-sec">What was on the table</div>' + MealDishesHTML(m) +
        '</div>'
      : "") +
  '</div>';
}

function CommunityMealsSectionHTML() {
  const groups = sortedMeals();
  const body = (groups.live.length === 0 && groups.past.length === 0)
    ? '<p class="helper-text" style="margin:0">No community meals yet. Start one and invite a ' +
        'friend — everyone says what they are bringing, and whatever you sign up for lands on ' +
        'your own calendar and shopping list.</p>'
    : groups.live.map(MealTileHTML).join("") +
      (groups.past.length
        ? '<div class="section-label">Past</div>' + groups.past.map(MealPastTileHTML).join("")
        : "");
  return '<div class="section-label">Community Meals</div>' +
    '<button class="btn meal-add" onclick="Actions.openNewMeal()">' + icon("plus", 15) +
      ' Add Community Meal</button>' +
    body;
}

/* The grid squares are too small to hold a long day, so the day itself opens.
   A chip goes straight to the recipe; the square behind it comes here. */
function CalDayModalHTML() {
  const key = state.calDay;
  if (!key) return modalShell("Day", "");
  const entries = scheduleOn(key);
  const planned = entries.length === 0
    ? '<p class="helper-text">Nothing scheduled yet. Find something below.</p>'
    : '<ul style="list-style:none;margin:0;padding:0" class="groc-list">' + entries.map(function (e) {
        const r = recipeById(e.recipeId);
        /* A dish brought to a community meal is managed from here like any
           other booking - opened, re-portioned, dropped. Only its day is not
           yours to move, because the host owns that. */
        const m = mealForEntry(e.entryId);
        return '<li class="groc-entry">' +
          '<button class="groc-entry-main" onclick="Actions.openScheduled(\\'' + e.entryId + '\\')">' +
            '<div class="groc-entry-label">' + esc(r ? r.title : e.title) + '</div>' +
            '<div class="groc-entry-sub">' + esc(String(e.servings)) + ' ' +
              esc(r ? r.servings.unit : "servings") +
              (m ? ' \u00b7 Community Meal: ' + esc(m.title) : "") +
              (r ? "" : " \u00b7 no longer in your box") + '</div>' +
          '</button>' +
          (r ? '<button class="icon-btn" title="' + (m ? 'Change the servings' : 'Change the day or the servings') + '" ' +
            'onclick="Actions.openScheduleEdit(\\'' + e.entryId + '\\')">' + icon("pencil", 15) + '</button>' : "") +
          '<button class="icon-btn" title="' + (m ? 'Take this off the meal' : 'Unschedule') + '" ' +
            'onclick="Actions.unschedule(\\'' + e.entryId + '\\')">' +
            icon("x", 15) + '</button>' +
        '</li>';
      }).join("") + '</ul>';
  return modalShell(shortDate(key),
    planned +
    '<div class="step-block" id="day-search-block"><div class="step-label">Add something to this day</div>' +
      '<div class="search-wrap">' +
        '<div class="search-field"><span class="icon">' + icon("search", 18) + '</span>' +
          '<input id="day-search" type="text" placeholder="Search everyone\\'s recipes..." ' +
            'value="' + esc(state.daySearch) + '" oninput="Actions.onDaySearchInput(this.value)" ' +
            'onfocus="Actions.onDaySearchFocus()" />' +
        '</div>' +
      '</div>' +
      '<div id="day-results">' + DayResultsHTML() + '</div>' +
    '</div>' +
    '<div class="edit-actions"><button class="btn" onclick="Actions.closeModal()">Close</button></div>');
}

/* Always the whole box, never what the Recipes tab happens to be filtered to.
   Someone looking for a dish to cook on Tuesday does not want yesterday's tag
   selection standing between them and it. */
const DAY_RESULT_MAX = 8;
function daySearchMatches() {
  const q = state.daySearch.trim().toLowerCase();
  if (!q) return [];
  return state.recipes.filter(function (r) {
    const hay = [r.title, r.description, r.owner, r.household]
      .concat(r.tags, r.ingredients.map(i => i.name)).join(" ").toLowerCase();
    return hay.indexOf(q) >= 0;
  });
}
function DayResultsHTML() {
  const q = state.daySearch.trim();
  if (!q) return '<p class="no-rating">Type to search titles, ingredients, tags and cooks.</p>';
  const all = daySearchMatches();
  if (all.length === 0) return '<p class="no-rating">Nothing matches "' + esc(q) + '".</p>';
  const shown = all.slice(0, DAY_RESULT_MAX);
  const more = all.length > shown.length
    ? '<p class="no-rating">' + (all.length - shown.length) + ' more — keep typing to narrow it down.</p>' : "";
  return '<ul class="groc-list">' + shown.map(function (r) {
    return '<li class="groc-entry">' +
      '<button class="groc-entry-main" onclick="Actions.scheduleFromDay(\\'' + r.recipeId + '\\')">' +
        '<div class="groc-entry-label">' + esc(r.title) + '</div>' +
        '<div class="groc-entry-sub">' + esc(r.household) +
          ' · ' + (r.servings.base || 1) + ' ' + esc(r.servings.unit) + '</div>' +
      '</button>' +
      '<button class="groc-entry-plus" aria-label="Schedule ' + esc(r.title) + '" ' +
        'onclick="Actions.scheduleFromDay(\\'' + r.recipeId + '\\')">' +
        icon("plus", 16) + '</button>' +
    '</li>';
  }).join("") + '</ul>' + more;
}

/* ====================================================================== */
/* Render: Friends                                                         */
/* ====================================================================== */
function FriendsViewHTML() {
  const row = (name, sub, right, chained) =>
    '<div class="friend-row">' +
    (chained ? '<span style="color:var(--accent);flex-shrink:0">' + icon("chain", 16) + '</span>' : "") +
    '<div class="friend-name">' + esc(name) +
    (sub ? '<div class="friend-sub">' + esc(sub) + '</div>' : "") + '</div>' + right + '</div>';

  const others = (members, exclude) => members.filter(m => m !== exclude);
  const alsoLine = (members, exclude) => {
    const rest = others(members, exclude);
    return rest.length ? "Shares a cookbook with " + rest.join(", ") + ", so they come too" : "";
  };

  const mates = state.mates.length
    ? state.mates.map(m => row(m, "Shares your cookbook — can edit everything you can", "", true)).join("")
    : "";

  const incoming = state.incoming.length
    ? state.incoming.map(f => row(f.by, alsoLine(f.members, f.by) || ("Asked " + fmtDate(f.createdAt)),
        '<button class="btn btn-sm btn-ok" onclick="Actions.respondFriend(\\'' + f.by + '\\',\\'accept\\')">' + icon("check", 15) + '</button>' +
        '<button class="btn btn-sm btn-no" onclick="Actions.respondFriend(\\'' + f.by + '\\',\\'decline\\')">' + icon("x", 15) + '</button>')).join("")
    : '<p class="helper-text">No requests waiting.</p>';

  const friends = state.friends.length
    ? state.friends.map(f => row(f.label, f.members.length > 1 ? "One cookbook between them" : "", '<button class="btn btn-sm btn-ghost" onclick="Actions.removeFriend(\\'' + (f.members[0] || "") + '\\')">Remove</button>')).join("")
    : '<p class="helper-text">No friends yet. Add someone by username above — once they accept, you will both see each other\\'s shared recipes.</p>';

  const outgoing = state.outgoing.length
    ? state.outgoing.map(f => row(f.label || f.members[0] || "", "Waiting for them to accept",
        '<button class="btn btn-sm btn-ghost" onclick="Actions.removeFriend(\\'' + (f.members[0] || "") + '\\')">Cancel</button>')).join("")
    : "";

  const declined = state.declined.length
    ? state.declined.map(f => row(f.by, "Their cookbook cannot ask you again",
        '<button class="btn btn-sm btn-ghost" onclick="Actions.allowFriend(\\'' + f.by + '\\')">Allow again</button>')).join("")
    : "";

  const unread = unreadNotifications().length;
  const tab = state.friendsTab === "notifications" ? "notifications" : "friends";

  const friendsPanel =
    '<p class="helper-text">Friendships link whole cookbooks. Add one person and you are linked to everyone who shares their cookbook, and they to everyone in yours. Recipes set to ' +
      esc(privateLabel()) + ' stay hidden either way.</p>' +
    '<div class="add-friend-row">' +
      '<input type="text" id="friend-name" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Their username" value="' + esc(state.friendPrefill || "") + '" />' +
      '<button class="btn btn-primary" onclick="Actions.sendFriendRequest()">' + icon("userPlus", 16) + ' Add</button>' +
    '</div>' +
    '<div class="section-label">Or have them scan this</div>' +
    '<div class="qr-side">' +
      '<div class="qr-holder">' + friendQrHTML(state.session.username, 126) + '</div>' +
      '<div class="qr-side-text">' +
        '<p class="helper-text" style="margin:0">Opens The Recipe Box, sets them up with a cookbook if they need one, and then asks them to confirm sending <b>' +
          esc(state.session.username) + '</b> a friend request. You still have to accept it.</p>' +
      '</div>' +
    '</div>' +
    (mates ? '<div class="section-label">In your cookbook</div>' + mates : "") +
    '<div class="section-label">Requests for you</div>' + incoming +
    '<div class="section-label">Your friends</div>' + friends +
    (outgoing ? '<div class="section-label">Requests you sent</div>' + outgoing : "") +
    (declined ? '<div class="section-label">Declined</div>' + declined : "");

  return '' +
    '<div class="wrap">' +
      '<div class="detail-top">' +
        '<button class="back-link" onclick="Actions.backToLibrary()">' + icon("chevronLeft", 18) + ' Recipe box</button>' +
      '</div>' +
      '<h1 class="detail-title font-display" style="font-size:26px">Friends</h1>' +
      '<div class="tabs">' +
        '<button class="' + (tab === "friends" ? "active" : "") + '" onclick="Actions.setFriendsTab(\\'friends\\')">' +
          icon("users", 16) + ' Friends' +
          (state.incoming.length ? '<span class="tab-count">' + state.incoming.length + '</span>' : "") + '</button>' +
        '<button class="' + (tab === "notifications" ? "active" : "") + '" onclick="Actions.setFriendsTab(\\'notifications\\')">' +
          icon("bell", 16) + ' Notifications' +
          (unread ? '<span class="tab-count">' + unread + '</span>' : "") + '</button>' +
      '</div>' +
      (tab === "notifications" ? NotificationsPanelHTML() : friendsPanel) +
    '</div>';
}

/* Two things get reported: a friend putting up a recipe you can now see, and
   somebody cooking one of yours. Each carries when it happened and a way
   straight to the thing it is about. */
function NotificationsPanelHTML() {
  const list = allNotifications();
  if (!list.length) {
    return '<p class="helper-text">Nothing new. When a friend shares a recipe, invites you to a community meal, or logs a cook of one of yours, it turns up here.</p>';
  }
  const unread = list.filter(function (n) { return !n.read; }).length;
  const tools =
    '<div class="notif-tools">' +
      '<button class="btn btn-sm" ' + (unread ? "" : "disabled") + ' onclick="Actions.markAllNotificationsRead()">' +
        icon("check", 14) + ' Mark all read</button>' +
      '<button class="btn btn-sm btn-ghost" onclick="Actions.clearNotifications()">' +
        icon("trash", 14) + ' Clear all</button>' +
    '</div>';
  const rows = list.map(function (n) {
    /* Both buttons stop the click here: without that the row's own handler
       fires too and the two toggles cancel each other out. */
    const guard = 'event.stopPropagation(); ';
    const openBtn = function (label) {
      return '<button class="btn btn-sm" onclick="' + guard +
        'Actions.openNotification(\\'' + esc(n.id) + '\\')">' + label + '</button>';
    };
    let line, open = "";
    if (n.kind === "friend") {
      line = 'You and <b>' + esc(n.who) + '</b> are now friends' +
        (n.count
          ? ' — you can see <b>' + n.count + '</b> of their recipe' + (n.count === 1 ? "" : "s")
          : '. They have not shared any recipes yet.');
      if (n.count) open = openBtn("Show recipes");
    } else if (n.kind === "recipe") {
      line = '<b>' + esc(n.who) + '</b> shared a recipe: <b>' + esc(n.title) + '</b>';
      open = openBtn("Open recipe");
    } else if (n.kind === "meal") {
      line = '<b>' + esc(n.who) + '</b> invited you to <b>' + esc(n.title) + '</b>' +
        (n.when ? ' on ' + esc(shortDate(n.when)) : "");
      open = openBtn("Open meal");
    } else if (n.kind === "mealAccept") {
      line = '<b>' + esc(n.who) + '</b> is coming to <b>' + esc(n.title) + '</b>' +
        (n.when ? ' on ' + esc(shortDate(n.when)) : "");
      open = openBtn("Open meal");
    } else {
      line = '<b>' + esc(n.who) + '</b> cooked your <b>' + esc(n.title) + '</b>' +
        (n.rating ? ' ' + starsOnly(n.rating) : "") +
        (n.comment ? '<br><span style="color:var(--ink-muted)">' + esc(n.comment) + '</span>' : "");
      open = openBtn("Open cook log");
    }
    return '<div class="notif' + (n.read ? " read" : "") + '" role="button" tabindex="0" ' +
      'title="' + (n.read ? "Mark unread" : "Mark read") + '" ' +
      'onclick="Actions.toggleNotificationRead(\\'' + esc(n.id) + '\\')">' +
      '<span class="notif-dot"></span>' +
      '<div class="notif-body">' +
        '<p class="notif-line">' + line + '</p>' +
        '<div class="notif-when">' + esc(fmtWhen(n.at)) + '</div>' +
      '</div>' +
      '<div class="notif-acts">' + open +
        '<button class="btn btn-sm btn-ghost" onclick="' + guard +
          'Actions.toggleNotificationRead(\\'' + esc(n.id) + '\\')">' +
          (n.read ? "Unread" : "Read") + '</button>' +
      '</div>' +
    '</div>';
  }).join("");
  return tools + rows;
}

/* ====================================================================== */
/* Watching a recipe for changes made elsewhere                            */
/* ====================================================================== */
/* Someone else in your cookbook may be editing the same recipe on another
   device. While a recipe is open we poll for its version and show a notice
   rather than swapping the page out underneath the reader. The banner is
   injected into a fixed slot so an in-progress edit is never re-rendered. */
const WATCH_INTERVAL_MS = 20000;
let watchTimer = null;

function startWatching() {
  stopWatching();
  if (!state.watch) return;
  watchTimer = setInterval(pollWatched, WATCH_INTERVAL_MS);
}
function stopWatching() {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
}
function setWatch(recipeId) {
  if (!recipeId) { state.watch = null; state.change = null; stopWatching(); return; }
  const r = state.recipes.find(x => x.recipeId === recipeId);
  state.watch = {
    recipeId,
    updatedAt: r ? r.updatedAt : null,
    comments: commentsFor(recipeId).length
  };
  state.change = null;
  startWatching();
}
async function pollWatched() {
  if (!state.watch || !state.session) return;
  if (typeof document !== "undefined" && document.hidden) return;
  if (state.view !== "detail" && state.view !== "edit") return;
  /* Holding the editor open keeps the lock alive. */
  if (state.view === "edit" && state.lockHeld) {
    try { await API("recipe/lock", { recipeId: state.lockHeld }); }
    catch (e) {
      if (e.code === "LOCKED") {
        /* Losing the lock is the more urgent news, so say that and stop
           here rather than letting the version check talk over it. */
        state.change = { kind: "taken", who: (e.detail && e.detail.lockedBy) || "Someone" };
        state.lockHeld = null;
        updateChangeBanner();
        return;
      }
    }
  }

  let res;
  try { res = await API("recipe/version", { recipeId: state.watch.recipeId }); }
  catch (e) { return; }
  if (!state.watch) return;

  if (res.lockedBy && state.view === "detail") {
    state.change = { kind: "editing", who: res.lockedBy };
    updateChangeBanner();
    return;
  }
  if (res.gone) {
    state.change = { kind: "gone", who: "" };
  } else if (state.watch.updatedAt && res.updatedAt !== state.watch.updatedAt) {
    state.change = { kind: "edit", who: res.updatedBy || "Someone" };
  } else if (res.comments > state.watch.comments) {
    state.change = { kind: "cook", who: res.lastCommentBy || "Someone" };
  } else {
    return;
  }
  updateChangeBanner();
}

function ChangeBannerHTML() {
  const c = state.change;
  if (!c) return "";
  const editing = state.view === "edit";
  let text, action;
  if (c.kind === "gone") {
    text = "This recipe has been deleted.";
    action = '<button class="btn btn-sm" onclick="Actions.backToLibrary()">Back to the recipe box</button>';
  } else if (c.kind === "editing") {
    text = esc(c.who) + " is editing this recipe right now.";
    action = "";
  } else if (c.kind === "taken") {
    text = esc(c.who) + " has taken over editing this recipe. You can still save, but you will be asked before anything of theirs is overwritten.";
    action = "";
  } else if (c.kind === "cook") {
    text = esc(c.who) + " logged a cook on this recipe.";
    action = '<button class="btn btn-sm" onclick="Actions.refreshWatched()">Refresh</button>';
  } else if (editing) {
    text = esc(c.who) + " saved changes to this recipe while you have been editing. Saving now will overwrite them.";
    action = '<button class="btn btn-sm" onclick="Actions.loadTheirVersion()">Load theirs</button>';
  } else {
    text = esc(c.who) + " updated this recipe.";
    action = '<button class="btn btn-sm" onclick="Actions.refreshWatched()">Refresh</button>';
  }
  return '<div class="change-banner">' + icon("alert", 16) +
    '<span class="banner-text">' + text + '</span>' + action + '</div>';
}
function updateChangeBanner() {
  const el = document.getElementById("change-banner");
  if (el) el.innerHTML = ChangeBannerHTML();
}

/* ====================================================================== */
/* Render: Detail                                                          */
/* ====================================================================== */
const SCALE_PRESETS = [0.25, 0.5, 1, 2, 4];

function CookLogHTML(r) {
  const list = commentsFor(r.recipeId).slice().sort((a, b) => String(b.cookedOn).localeCompare(String(a.cookedOn)));
  const shown = state._showAllLogs ? list : list.slice(0, 4);
  const me = state.session.username.toLowerCase();
  const items = list.length === 0
    ? '<p class="no-rating">Not cooked yet — log it after your first time through.</p>'
    : '<ul style="list-style:none;margin:0;padding:0">' + shown.map(c =>
        '<li class="log-item"><div style="min-width:0">' +
          '<div class="log-user">' + esc(c.username) + '</div>' +
          '<div class="log-date">' + esc(fmtDate(c.cookedOn)) + '</div>' +
          (c.comment ? '<p class="log-notes">' + esc(c.comment) + '</p>' : "") +
        '</div><div class="log-right">' + starsOnly(c.rating) +
          (c.username.toLowerCase() === me ? '<button class="icon-btn" onclick="Actions.deleteComment(\\'' + c.commentId + '\\')">' + icon("trash", 14) + '</button>' : "") +
        '</div></li>').join("") + '</ul>' +
      (list.length > 4 ? '<button class="show-all-btn" onclick="Actions.toggleShowAllLogs()">' + (state._showAllLogs ? "Show fewer" : "Show all " + list.length) + '</button>' : "");

  const audience = r.ours
    ? (r.visibility === "friends"
        ? "Everyone in your cookbook and all your friends can see these entries."
        : (state.mates.length
            ? "This recipe is set to Just us, so only your cookbook can see these entries."
            : "This recipe is private, so only you can see these entries."))
    : "You, " + esc(r.owner) + "'s cookbook, and their friends can see these entries.";

  return '<div class="log-section">' +
      '<div class="log-header"><h2 class="font-display">Cook log</h2>' +
      '<button class="btn btn-primary btn-sm" onclick="Actions.openModal(\\'logCook\\')">' + icon("check", 14) + ' Log this cook</button></div>' +
      '<p class="helper-text">' + audience + '</p>' +
      items +
    '</div>';
}

/* hideLog suppresses the cook log for a reader who is not linked to the
   owner's cookbook. Ratings and comments stay between friends, so a recipe
   reached by a bare link shows the food and none of the conversation. */
function RecipeBodyHTML(r, hideLog) {
  const scale = state.scale;
  const scaledServings = Math.round(r.servings.base * scale * 100) / 100;
  const m = r.macrosPerServing || {};

  const scaleBtns = SCALE_PRESETS.map(p =>
    '<button class="scale-btn ' + (!state.customScaleOpen && scale === p ? "active" : "") + '" onclick="Actions.setScale(' + p + ')">' + p + 'x</button>'
  ).join("");

  const ingItems = r.ingredients.map(ing => {
    const mv = scaledVal(ing.metricValue, scale);
    const cv = scaledVal(ing.customaryValue, scale);
    const alt = (ing.customaryValue !== "" && ing.customaryValue != null)
      ? ' <span class="alt">(' + formatCustomary(cv, ing.customaryUnit) + ')</span>' : "";
    return '<li><span class="ing-amt font-mono">' + formatMetric(mv, ing.metricUnit) + alt + '</span>' +
      '<span>' + esc(ing.name) + (ing.notes ? ' <span class="alt">— ' + esc(ing.notes) + '</span>' : "") + '</span></li>';
  }).join("");

  const stepItems = r.steps.map((s, idx) => {
    const timer = (s.timerMinutes !== "" && s.timerMinutes != null)
      ? '<span class="step-timer">' + icon("clock", 12) + ' ' + s.timerMinutes + ' min</span>' : "";
    return '<li><span class="step-num font-mono">' + (idx + 1) + '</span><span class="step-text">' + esc(s.text) + timer + '</span></li>';
  }).join("");

  return '' +
    '<div class="row2">' +
      '<div class="panel"><div class="panel-label">Servings</div>' +
        '<div class="scale-row">' + scaleBtns +
          '<button class="scale-btn ' + (state.customScaleOpen ? "active" : "") + '" onclick="Actions.toggleCustomScale()">Custom</button>' +
          (state.customScaleOpen ? '<input class="scale-custom-input" type="number" min="0.1" step="0.1" value="' + scale + '" onchange="Actions.setCustomScale(this.value)" />' : "") +
        '</div>' +
        '<p class="makes-line">Makes <span class="font-mono" style="color:var(--ink)">' + scaledServings + '</span> ' + esc(r.servings.unit) + '</p>' +
      '</div>' +
      '<div class="panel"><div class="panel-label"><span>Per serving</span><span>' + (m.source === "site" ? "from source" : "estimated") + '</span></div>' +
        '<div class="macro-grid">' +
          '<div><div class="val font-mono">' + (m.calories === "" || m.calories == null ? "—" : m.calories) + '</div><div class="lbl">kcal</div></div>' +
          '<div><div class="val font-mono">' + (m.proteinG === "" || m.proteinG == null ? "—" : m.proteinG) + '</div><div class="lbl">protein g</div></div>' +
          '<div><div class="val font-mono">' + (m.fatG === "" || m.fatG == null ? "—" : m.fatG) + '</div><div class="lbl">fat g</div></div>' +
          '<div><div class="val font-mono">' + (m.carbsG === "" || m.carbsG == null ? "—" : m.carbsG) + '</div><div class="lbl">carbs g</div></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="cook-columns">' +
      '<div class="cook-col-left"><h2 class="col-title font-display">Ingredients</h2><ul class="ing-list">' + ingItems + '</ul></div>' +
      '<div class="cook-col-right"><h2 class="col-title font-display">Steps</h2><ol class="step-list" style="list-style:none;padding:0;margin:0">' + stepItems + '</ol>' +
        /* Where it came from, under the method it produced. Only ever shown
           where the field was actually filled in, so a recipe of your own
           does not carry an empty credit. */
        ((r.source && r.source.url)
          ? '<div class="source-credit">' +
              '<div class="small-label">Source of Inspiration</div>' +
              '<a href="' + esc(r.source.url) + '" target="_blank" rel="noopener noreferrer">' +
                esc(r.source.url) + '</a>' +
            '</div>'
          : "") +
      '</div>' +
    '</div>' +
    (r.notes ? '<div class="notes-box"><b>Notes:</b> ' + esc(r.notes) + '</div>' : "") +
    (hideLog ? "" : CookLogHTML(r));
}

function DetailViewHTML(r) {
  if (!r) return '<div class="wrap"><p style="padding-top:30px">That recipe is no longer in your box.</p>' +
    '<button class="btn" onclick="Actions.backToLibrary()">Back to the recipe box</button></div>';
  const st = statsFor(r.recipeId);
  const action = r.ours
    ? '<button class="btn btn-sm" onclick="Actions.openEdit(\\'' + r.recipeId + '\\')">' + icon("pencil", 14) + ' Edit</button>'
    : "";
  /* Who and how well it went, straight under the name. Where the recipe came
     from a cookbook we are not linked to - a pin taken from a share link -
     the name is a button that asks to be friends. */
  const knownHousehold = state.friends.some(function (f) { return f.label === r.household; });
  const credit = r.ours
    ? (r.owner === state.session.username ? "" : '<span class="owner-badge">' + icon("chain", 11) + ' ' + esc(r.owner) + '</span>')
    : knownHousehold
      ? '<span class="owner-badge">from ' + esc(r.household) + '</span>'
      : '<button class="owner-badge owner-badge-btn" onclick="Actions.askToBeFriends(\\'' + esc(r.owner) + '\\')">' +
          'from ' + esc(r.household) + ' ' + icon("userPlus", 11) + '</button>';
  const creditRow = '<div class="detail-meta" style="margin-bottom:10px">' + credit +
    ratingHTML(st.avg, st.count) +
    (st.count ? '<span class="cooked-count">cooked ' + st.count + '×</span>' : "") +
  '</div>';
  /* Who can see it sits with the other things you can do to the recipe. It
     and Pin are never both there: one is for a recipe of yours, the other
     for somebody else's. */
  const markRow = '<div class="detail-marks">' + MarkButtonsHTML(r, true) +
    (r.ours ? visibilityPill(r, true) : "") + '</div>';
  /* Its own row underneath, because it does something to the calendar rather
     than to the recipe and reads oddly sitting among the marks. */
  const schedRow = '<div class="detail-marks">' + ScheduleMarkHTML(r, true) + '</div>';
  /* Arrived here from a calendar square: say which one, and offer the way
     back out of it. The portions are already applied to the body below. */
  const sf = state.scheduledFor;
  const schedBanner = (sf && sf.recipeId === r.recipeId)
    ? '<div class="sched-banner">' + icon("calGrid", 15) +
        '<span>Scheduled for <b>' + esc(shortDate(sf.date)) + '</b> · <b>' + esc(String(sf.servings)) +
        '</b> ' + esc(r.servings.unit) + '</span>' +
        '<button class="btn btn-sm btn-no" style="margin-left:auto" onclick="Actions.unschedule(\\'' + sf.entryId + '\\')">' +
        icon("x", 13) + ' Unschedule</button>' +
      '</div>'
    : "";
  const qrBlock = ShareBlockHTML(r.recipeId, r.visibility, r.ours);
  const tags = r.tags.length
    ? '<div class="detail-tags">' + r.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join("") + '</div>'
    : "";
  const prov = r.mergedFrom
    ? '<div class="provenance">Copied from ' + esc(r.mergedFrom.username) + '\\'s cookbook on ' + esc(fmtDate(r.mergedFrom.date)) + '. Their ratings and comments stayed with the original.</div>'
    : "";
  return '' +
    '<div class="wrap">' +
      '<div class="detail-top">' +
        '<button class="back-link" onclick="Actions.backToLibrary()">' + icon("chevronLeft", 18) + ' Recipe box</button>' +
        action +
      '</div>' +
      '<div id="change-banner">' + ChangeBannerHTML() + '</div>' +
      '<h1 class="detail-title font-display">' + esc(r.title) + '</h1>' +
      creditRow +
      schedBanner +
      markRow +
      schedRow +
      qrBlock +
      tags +
      prov +
      '<div id="recipe-body">' + RecipeBodyHTML(r) + '</div>' +
    '</div>';
}
/* The one path every control inside the recipe body re-renders through:
   the scale presets, the custom multiplier, the show-all-logs toggle. It
   resolved the recipe out of the library, which is exactly where a linked
   recipe is not - so on a link view it found nothing and every one of those
   buttons did nothing at all. Where a recipe had been opened earlier in the
   session it was worse than nothing: activeId still pointed at that one, so
   the row would have redrawn somebody else's food under the linked title.
   hideLog has to travel with it too, or re-scaling a bare link would sprout
   a cook log the first render deliberately withheld. */
function updateRecipeBody() {
  const el = document.getElementById("recipe-body");
  if (!el) return;
  const linked = (state.view === "link" && state.linkRecipe) ? state.linkRecipe.body : null;
  const r = linked || getActiveRecipe();
  if (!r) return;
  el.innerHTML = RecipeBodyHTML(r, !!linked);
}

/* ====================================================================== */
/* Render: Edit / New                                                      */
/* ====================================================================== */
const METRIC_UNITS = [["g", "g"], ["kg", "kg"], ["ml", "mL"], ["l", "L"], ["each", "each"]];
const CUSTOMARY_UNITS = [["cup", "cup"], ["tbsp", "tbsp"], ["tsp", "tsp"], ["oz", "oz"], ["lb", "lb"], ["each", "each"]];
function unitSelectHTML(id, current, options) {
  const matched = options.some(o => o[0] === current);
  const extra = (!matched && current) ? '<option value="' + esc(current) + '" selected>' + esc(current) + '</option>' : "";
  const opts = options.map(o => '<option value="' + o[0] + '"' + (current === o[0] ? " selected" : "") + '>' + o[1] + '</option>').join("");
  return '<select id="' + id + '">' + extra + opts + '</select>';
}
function IngredientRowHTML(ing, idx, total) {
  return '' +
    '<div class="ing-row">' +
      '<input class="ing-name-input" id="ing-name-' + idx + '" placeholder="Ingredient name" value="' + esc(ing.name) + '" />' +
      '<div class="ing-grid">' +
        '<input id="ing-mval-' + idx + '" type="number" placeholder="metric #" value="' + esc(ing.metricValue) + '" />' +
        unitSelectHTML("ing-munit-" + idx, ing.metricUnit, METRIC_UNITS) +
        '<input id="ing-cval-' + idx + '" type="number" placeholder="cust #" value="' + esc(ing.customaryValue) + '" />' +
        unitSelectHTML("ing-cunit-" + idx, ing.customaryUnit, CUSTOMARY_UNITS) +
        '<div class="step-controls">' +
          '<button class="icon-btn" ' + (idx === 0 ? "disabled" : "") + ' onclick="Actions.moveIngredient(' + idx + ',-1)">' + icon("chevronUp", 15) + '</button>' +
          '<button class="icon-btn" ' + (idx === total - 1 ? "disabled" : "") + ' onclick="Actions.moveIngredient(' + idx + ',1)">' + icon("chevronDown", 15) + '</button>' +
        '</div>' +
        '<button class="icon-btn" onclick="Actions.removeIngredient(' + idx + ')">' + icon("x", 16) + '</button>' +
      '</div>' +
      '<input class="ing-notes-input" id="ing-notes-' + idx + '" placeholder="notes (optional)" value="' + esc(ing.notes) + '" />' +
    '</div>';
}
function StepRowHTML(s, idx, total) {
  return '' +
    '<div class="step-row">' +
      '<div class="step-idx font-mono">' + (idx + 1) + '</div>' +
      '<textarea id="step-text-' + idx + '" rows="4">' + esc(s.text) + '</textarea>' +
      '<input class="timer-input" id="step-timer-' + idx + '" type="number" placeholder="min" value="' + esc(s.timerMinutes) + '" />' +
      '<div class="step-controls">' +
        '<button class="icon-btn" ' + (idx === 0 ? "disabled" : "") + ' onclick="Actions.moveStep(' + idx + ',-1)">' + icon("chevronUp", 15) + '</button>' +
        '<button class="icon-btn" ' + (idx === total - 1 ? "disabled" : "") + ' onclick="Actions.moveStep(' + idx + ',1)">' + icon("chevronDown", 15) + '</button>' +
      '</div>' +
      '<button class="icon-btn" onclick="Actions.removeStep(' + idx + ')">' + icon("x", 16) + '</button>' +
    '</div>';
}

/* Four ways in, all the same shape: get a prompt, run it wherever you keep
   your AI, paste the answer back. Named for where the recipe is coming from
   rather than for the step you are about to do. */
const IMPORT_ORDER = ["url", "text", "photo", "chat"];
function ImportButtonsHTML() {
  return IMPORT_ORDER.map(function (mode) {
    const s = IMPORT_SOURCES[mode];
    return '<button class="btn btn-sm" onclick="Actions.openImportPrompt(\\'' + mode + '\\')">' +
      icon(s.icon, 14) + ' ' + s.label + '</button>';
  }).join("");
}

function EditViewHTML() {
  const d = state.editDraft;
  const isNew = state.editIsNew;
  const ingredientsHTML = d.ingredients.map((ing, idx) => IngredientRowHTML(ing, idx, d.ingredients.length)).join("");
  const stepsHTML = d.steps.map((s, idx) => StepRowHTML(s, idx, d.steps.length)).join("");
  return '' +
    '<div class="wrap">' +
      '<div class="detail-top">' +
        '<button class="back-link" onclick="Actions.cancelEdit()">' + icon("chevronLeft", 18) + ' Cancel</button>' +
        '<div class="edit-actions">' +
          (isNew
            ? ImportButtonsHTML()
            : '<button class="btn btn-ghost btn-sm" onclick="Actions.deleteRecipe()">' + icon("trash", 14) + ' Delete</button>') +
          '<button class="btn btn-primary btn-sm" onclick="Actions.saveRecipeForm()">' + icon("check", 14) + ' Save recipe</button>' +
        '</div>' +
      '</div>' +
      '<div id="change-banner">' + ChangeBannerHTML() + '</div>' +
      '<h1 class="detail-title font-display" style="font-size:23px">' + (isNew ? "New recipe" : "Edit recipe") + '</h1>' +
      '<div class="field"><label>Who can see this recipe</label>' +
        '<div class="seg">' +
          '<button class="' + (d.visibility === "private" ? "active" : "") + '" onclick="Actions.setDraftVisibility(\\'private\\')">' + icon("lock", 15) + ' ' + privateLabel() + '</button>' +
          '<button class="' + (d.visibility === "selective" ? "active" : "") + '" onclick="Actions.setDraftVisibility(\\'selective\\')">' + icon("userPlus", 15) + ' Selective share</button>' +
          '<button class="' + (d.visibility === "friends" ? "active" : "") + '" onclick="Actions.setDraftVisibility(\\'friends\\')">' + icon("globe", 15) + ' All friends</button>' +
        '</div>' +
        (d.visibility ? "" : '<p class="req-note">Pick one before saving.</p>') +
        (d.visibility === "selective" ? PrivateShareHTML(d) : "") +
      '</div>' +
      '<div class="field"><label>Title</label><input type="text" id="f-title" value="' + esc(d.title) + '" placeholder="Braised beef short ribs" /></div>' +
      '<div class="field"><label>Description</label><textarea id="f-description" rows="2">' + esc(d.description) + '</textarea></div>' +
      TagPickerHTML(d) +
      '<div class="two-col">' +
        '<div class="field"><label>Base servings</label><input type="number" min="1" id="f-servings-base" value="' + esc(d.servings.base) + '" /></div>' +
        '<div class="field"><label>Unit</label><input type="text" id="f-servings-unit" value="' + esc(d.servings.unit) + '" placeholder="servings" /></div>' +
      '</div>' +
      '<div class="field"><label>Macros per serving</label>' +
        '<div class="macro-edit-grid">' +
          '<input type="number" id="f-macro-calories" placeholder="calories" value="' + esc(d.macrosPerServing.calories) + '" />' +
          '<input type="number" id="f-macro-protein" placeholder="protein g" value="' + esc(d.macrosPerServing.proteinG) + '" />' +
          '<input type="number" id="f-macro-fat" placeholder="fat g" value="' + esc(d.macrosPerServing.fatG) + '" />' +
          '<input type="number" id="f-macro-carbs" placeholder="carbs g" value="' + esc(d.macrosPerServing.carbsG) + '" />' +
        '</div>' +
        '<select id="f-macro-source"><option value="site"' + (d.macrosPerServing.source === "site" ? " selected" : "") + '>From source</option>' +
          '<option value="estimated"' + (d.macrosPerServing.source === "estimated" ? " selected" : "") + '>Estimated</option></select>' +
      '</div>' +
      '<div class="subhead-row"><span class="small-label">Ingredients</span><button class="btn btn-sm btn-ghost" onclick="Actions.addIngredient()">' + icon("plus", 14) + ' Add</button></div>' +
      '<div id="ingredients-container">' + ingredientsHTML + '</div>' +
      '<div class="subhead-row" style="margin-top:16px"><span class="small-label">Steps</span><button class="btn btn-sm btn-ghost" onclick="Actions.addStep()">' + icon("plus", 14) + ' Add</button></div>' +
      '<div id="steps-container">' + stepsHTML + '</div>' +
      '<div class="field" style="margin-top:16px"><label>Source URL (optional)</label>' +
        '<input type="url" id="f-source-url" inputmode="url" autocomplete="off" ' +
          'placeholder="https://..." value="' + esc((d.source && d.source.url) || "") + '" />' +
        '<p class="helper-text">Filled in for you when a recipe is imported from a website. ' +
          'Shown under the steps as Source of Inspiration.</p></div>' +
      '<div class="field" style="margin-top:16px"><label>Notes</label><textarea id="f-notes" rows="2" placeholder="Anything worth remembering next time">' + esc(d.notes) + '</textarea></div>' +
    '</div>';
}

function syncDraftFromDOM() {
  const d = state.editDraft;
  if (!d) return;
  const get = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
  if (get("f-title") !== undefined) d.title = get("f-title");
  if (get("f-description") !== undefined) d.description = get("f-description");
  /* tags are chips, not typed text, so nothing to harvest here */
  if (get("f-servings-base") !== undefined) d.servings.base = parseFloat(get("f-servings-base")) || d.servings.base;
  if (get("f-servings-unit") !== undefined) d.servings.unit = get("f-servings-unit");
  if (get("f-macro-calories") !== undefined) d.macrosPerServing.calories = numOrEmpty(get("f-macro-calories"));
  if (get("f-macro-protein") !== undefined) d.macrosPerServing.proteinG = numOrEmpty(get("f-macro-protein"));
  if (get("f-macro-fat") !== undefined) d.macrosPerServing.fatG = numOrEmpty(get("f-macro-fat"));
  if (get("f-macro-carbs") !== undefined) d.macrosPerServing.carbsG = numOrEmpty(get("f-macro-carbs"));
  if (get("f-macro-source") !== undefined) d.macrosPerServing.source = get("f-macro-source");
  if (get("f-notes") !== undefined) d.notes = get("f-notes");
  /* normalizeBody drops the whole source object when the url is empty, so
     clearing the field is how you take a credit off a recipe. The site name
     is kept where the url has not changed, since only the url is editable. */
  if (get("f-source-url") !== undefined) {
    const url = String(get("f-source-url")).trim();
    d.source = url ? { url: url, site: (d.source && d.source.site) || "" } : null;
  }
  d.ingredients = d.ingredients.map((ing, idx) => {
    if (get("ing-name-" + idx) === undefined) return ing;
    return Object.assign({}, ing, {
      name: get("ing-name-" + idx),
      metricValue: numOrEmpty(get("ing-mval-" + idx)),
      metricUnit: get("ing-munit-" + idx),
      customaryValue: numOrEmpty(get("ing-cval-" + idx)),
      customaryUnit: get("ing-cunit-" + idx),
      notes: get("ing-notes-" + idx)
    });
  });
  d.steps = d.steps.map((s, idx) => {
    if (get("step-text-" + idx) === undefined) return s;
    return Object.assign({}, s, { text: get("step-text-" + idx), timerMinutes: numOrEmpty(get("step-timer-" + idx)) });
  });
}

function blankDraft() {
  const d = normalizeBody({ title: "", ingredients: [{}], steps: [{}] });
  d.title = "";
  d.visibility = "";
  d._shareWith = [];
  d._tags = [];
  return d;
}

/* ====================================================================== */
/* Render: Modals                                                          */
/* ====================================================================== */
const OWNER_FIXED = [
  ["ours", "My cookbook"],
  ["all", "Everyone's recipes"],
  ["star", "Favorites"],
  ["later", "Saved for later"]
];
function ownerFilterLabel() {
  const fixed = OWNER_FIXED.filter(o => o[0] === state.ownerFilter)[0];
  return fixed ? fixed[1] : state.ownerFilter;
}

/* Whose recipes am I looking at. My cookbook sits at the top; friends are
   alphabetical and searchable, because a list of names gets long. */
function OwnerModalHTML() {
  const q = (state.pickSearch || "").trim().toLowerCase();
  const rows = [];
  const add = (value, label) => rows.push(
    '<button class="pick-row' + (state.ownerFilter === value ? " on" : "") + '" ' +
    'onclick="Actions.pickOwner(' + rows.length + ')">' + esc(label) + '</button>');
  const values = [];
  OWNER_FIXED.forEach(function (o) {
    if (q && o[1].toLowerCase().indexOf(q) < 0) return;
    values.push(o[0]); add(o[0], o[1]);
  });
  friendLabels()
    .filter(f => !q || f.toLowerCase().indexOf(q) >= 0)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .forEach(function (f) { values.push(f); add(f, f); });
  state._ownerList = values;
  return modalShell("Whose recipes",
    '<input type="text" id="pick-search" autocomplete="off" placeholder="Search friends..." ' +
      'value="' + esc(state.pickSearch || "") + '" oninput="Actions.pickSearch(this.value)" />' +
    '<div class="pick-list">' + (rows.join("") || '<p class="helper-text">No one by that name.</p>') + '</div>');
}

/* A stable key per panel so the open/closed shape of the menu survives a
   re-render. Names repeat across the tree (Chops sits under Pork and Lamb),
   so the key carries the whole path. */
function panelKey(parent, name) { return parent + "/" + name; }
function catPanelKey(c) { return "cat:" + c.key; }
/* Every label at or below a node, the node's own name included when it is
   itself selectable. Deduped, because a tag can hang in two places. */
function labelsUnder(node, withSelf) {
  const out = [], seen = {};
  const add = function (l) {
    const k = String(l).toLowerCase();
    if (!seen[k]) { seen[k] = 1; out.push(l); }
  };
  const walk = function (n, self) {
    if (self && n.name) add(n.name);
    (n.groups || []).forEach(function (g) { walk(g, true); });
    (n.tags || []).forEach(add);
  };
  walk(node, withSelf);
  return out;
}
/* Opening the menu shows you where your current picks live. After that the
   panels answer only to you - toggling a tag never folds anything away. */
function seedFilterPanels() {
  const on = l => state.activeTags.some(x => x.toLowerCase() === String(l).toLowerCase());
  const walkGroup = function (g, parent) {
    const key = panelKey(parent, g.name);
    if (labelsUnder(g, true).some(on)) state._fopen[key] = true;
    (g.groups || []).forEach(function (x) { walkGroup(x, key); });
  };
  TAG_TREE.forEach(function (c) {
    const key = catPanelKey(c);
    if (labelsUnder(c, false).some(on)) state._fopen[key] = true;
    (c.groups || []).forEach(function (g) { walkGroup(g, key); });
  });
}

function FiltersModalHTML() {
  const flat = [], panels = [], badges = [];
  const chosen = l => state.activeTags.some(x => x.toLowerCase() === String(l).toLowerCase());
  const count = (node, withSelf) => labelsUnder(node, withSelf).filter(chosen).length;
  /* The badge is always in the markup, only invisible while it reads zero.
     Picking your first tag used to conjure one out of nothing, which grew
     the row, grew the box, and shoved the whole menu upward. */
  const badge = (node, withSelf) => {
    const n = count(node, withSelf);
    const i = badges.push([node, withSelf]) - 1;
    return '<span class="fcount' + (n ? "" : " zero") + '" data-fc="' + i + '">' + n + '</span>';
  };
  const box = (label, shown, extra) => {
    const i = flat.push(label) - 1;
    return '<button class="fbox' + (extra || "") + (chosen(label) ? " on" : "") +
      '" data-fb="' + i + '" onclick="Actions.toggleFilterAt(' + i + ')">' + esc(shown || label) + '</button>';
  };
  const panel = key => {
    const i = panels.push(key) - 1;
    return (state._fopen[key] ? " open" : "") + ' ontoggle="Actions.setPanel(' + i + ', this.open)"';
  };
  /* A group heading opens and closes; the group itself is picked with the
     All chip inside it, so "All Beef" still catches a recipe tagged Brisket. */
  const group = (g, parent) => {
    const key = panelKey(parent, g.name);
    return '<details class="fgrp"' + panel(key) + '>' +
      '<summary>' + esc(g.name) + badge(g, true) + '</summary>' +
      '<div class="fgrp-body">' +
        '<div class="fwrap">' + box(g.name, "All " + g.name, " fbox-all") +
          (g.tags || []).map(t => box(t)).join("") + '</div>' +
        (g.groups || []).map(x => group(x, key)).join("") +
      '</div>' +
    '</details>';
  };
  const body = TAG_TREE.map(c =>
    '<details class="fcat"' + panel(catPanelKey(c)) + '>' +
      '<summary>' + esc(c.name) + badge(c, false) + '</summary>' +
      ((c.tags || []).length ? '<div class="fwrap">' + c.tags.map(t => box(t)).join("") + '</div>' : "") +
      (c.groups || []).map(g => group(g, catPanelKey(c))).join("") +
    '</details>').join("");
  const html = modalShell("Filters",
    '<div class="filter-scroll"><div class="filter-body" onscroll="updateFilterScrollHint()">' +
      body + '</div></div>' +
    '<div class="edit-actions">' +
      '<button class="btn" onclick="Actions.clearFilters()">Clear selected tags</button>' +
      '<button class="btn btn-primary" onclick="Actions.closeModal()">Done</button>' +
    '</div>');
  state._filterList = flat;
  state._panelKeys = panels;
  state._badgeList = badges;
  return html;
}

/* Picking a tag changes two things and two things only: which chips are lit
   and what the counts say. Touch just those and the menu cannot move. */
function updateFilterBoxes() {
  const root = document.querySelector(".filter-body");
  if (!root) return;
  const list = state._filterList || [];
  const on = l => state.activeTags.some(x => x.toLowerCase() === String(l).toLowerCase());
  const els = root.querySelectorAll("[data-fb]");
  for (let j = 0; j < els.length; j++) {
    const label = list[Number(els[j].getAttribute("data-fb"))];
    if (label !== undefined) els[j].classList.toggle("on", on(label));
  }
}
function updateFilterCounts() {
  const root = document.querySelector(".filter-body");
  if (!root) return;
  const list = state._badgeList || [];
  const on = l => state.activeTags.some(x => x.toLowerCase() === String(l).toLowerCase());
  const els = root.querySelectorAll("[data-fc]");
  for (let j = 0; j < els.length; j++) {
    const pair = list[Number(els[j].getAttribute("data-fc"))];
    if (!pair) continue;
    const n = labelsUnder(pair[0], pair[1]).filter(on).length;
    els[j].textContent = n;
    els[j].classList.toggle("zero", !n);
  }
}

function appUrl() {
  const o = window.location && window.location.origin;
  return (o && o.indexOf("http") === 0 ? o : "https://recipe-box.richardernst15.workers.dev") + "/";
}
/* One place to hand the app to somebody, in whichever of the two ways suits
   the room: point a camera at the code, or send the link. Both land on the
   plain front door and carry nothing about the account showing them. */
function ShareAppModalHTML() {
  return modalShell("Share App",
    '<div class="field"><label>App link</label>' +
      '<div class="qr-side">' +
        '<div class="qr-holder">' + appQrHTML(126) + '</div>' +
        '<div class="qr-side-text">' +
          '<div class="code-box font-mono">' + esc(appUrl()) + '</div>' +
          '<button class="btn btn-sm btn-block" onclick="Actions.copyAppUrl()">' + icon("copy", 14) + ' Copy link</button>' +
        '</div>' +
      '</div>' +
      '<p class="helper-text">They open it, make their own cookbook, and then you add each other by username. ' +
      'Safe to give to anyone: it opens the app and nothing more.</p>' +
    '</div>' +
    '<div class="field"><label>Add to a home screen</label>' +
      '<p class="helper-text"><b>iPhone or iPad:</b> open the link in Safari, tap Share, then Add to Home Screen.<br>' +
      '<b>Android:</b> open the link in Chrome, tap the three-dot menu, then Install app.</p>' +
    '</div>');
}

/* A private recipe can still be handed to particular friends - the coveted
   one you share with a best friend and nobody else. Targets are cookbooks,
   so a household gets it together. */
function PrivateShareHTML(d) {
  const chosen = d._shareWith || [];
  if (!state.friends.length) {
    return '<p class="helper-text">Only your cookbook can see this. Add a friend and you will be able to hand it to them individually.</p>';
  }
  const rows = state.friends.map(function (f, i) {
    const key = (f.members[0] || "");
    const on = chosen.indexOf(key) >= 0;
    return '<label class="share-row"><input type="checkbox"' + (on ? " checked" : "") +
      ' onchange="Actions.toggleShare(' + i + ')" /> ' + esc(f.label) + '</label>';
  }).join("");
  return '<p class="helper-text" style="margin-top:10px">Only your cookbook and the friends you tick here. They can open it by link or code.</p>' +
    '<div>' + rows + '</div>';
}

function TagPickerHTML(d) {
  const chips = (d._tags || []).map((t, i) =>
    '<span class="tagchip">' + esc(t) +
    '<button onclick="Actions.removeDraftTag(' + i + ')">' + icon("x", 11) + '</button></span>').join("");
  return '<div class="field"><label>Tags</label>' +
    '<div class="tagchips">' + (chips || '<span class="helper-text">None yet</span>') + '</div>' +
    '<input type="text" id="f-tagsearch" autocomplete="off" autocapitalize="none" spellcheck="false" ' +
      'placeholder="Type to find a tag" oninput="Actions.tagTypeahead(this.value)" />' +
    '<div class="tag-suggest" id="tag-suggest"></div>' +
    '<p class="helper-text">Tags come from a set list, so a filter finds every recipe that fits.</p></div>';
}

function modalShell(title, inner) {
  return '<div class="modal-overlay" onclick="if(event.target===this)Actions.closeModal()"><div class="modal-box">' +
    '<div class="modal-head"><h3 class="font-display">' + title + '</h3>' +
    '<button class="modal-close" onclick="Actions.closeModal()">' + icon("x", 20) + '</button></div>' +
    (state.modalError ? '<div class="modal-error">' + esc(state.modalError) + '</div>' : "") +
    inner + '</div></div>';
}

function LogCookModalHTML() {
  const r = getActiveRecipe();
  let stars = "";
  for (let n = 1; n <= 5; n++) {
    stars += '<button type="button" class="icon-btn" style="padding:3px" onclick="Actions.setLogRating(' + n + ')">' +
      icon("star", 28, n <= state.logRating ? "star-filled" : "star-empty") + '</button>';
  }
  return modalShell("Log this cook",
    '<p class="helper-text">' + esc(r ? r.title : "") + ' — a rating is required, the comment is up to you.</p>' +
    '<div class="field"><label>Date cooked</label><input type="date" id="cl-date" value="' + todayStr() + '" /></div>' +
    '<div class="field"><label>Rating</label><div>' + stars + '</div></div>' +
    '<div class="field"><label>Comment (optional)</label><textarea id="cl-notes" rows="3" placeholder="Kids liked it, a bit salty..."></textarea></div>' +
    '<div class="edit-actions"><button class="btn" onclick="Actions.closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="Actions.saveCookLog()">Save to cook log</button></div>');
}

/* The Schedule frame: a day, how many you are feeding, and what that comes to
   in ingredients. Portions here are a count rather than a multiplier - the
   recipe view asks "how many times this recipe", the calendar asks "how many
   people on Tuesday", and the second is the question you actually have. */
/* One week at a time, scrolled the same way the calendar tab is: a box
   exactly one row tall over a tall stack of weeks. Tapping a day sets the
   date, and the chips already sitting in each square answer the question you
   would otherwise have to close the dialog to check - is Tuesday free? */
/* These have to agree with the stylesheet exactly: .sched-cell is 68px tall
   and the grid gap is 3px, so one week is 71px. Anything else and the strip
   opens on the wrong week, drifting further the more weeks are rendered. */
const SCHED_CELL_H = 68, SCHED_GAP = 3;
const SCHED_ROW = SCHED_CELL_H + SCHED_GAP;
const SCHED_WEEKS_AHEAD = 52;
/* The window starts at this week and runs forward. Scheduling is a
   forward-looking act, and rendering a year of dead weeks above the fold was
   what put the opening position in doubt in the first place. The one
   exception is a booking already sitting in the past, which still has to be
   reachable in order to be edited. */
function schedAnchor(selected) {
  const t = localToday();
  return sundayOf(selected && selected < t ? selected : t);
}
function schedWeekStarts(around) {
  const first = schedAnchor(around);
  const weeks = [];
  for (let i = 0; i <= SCHED_WEEKS_AHEAD; i++) weeks.push(addDays(first, 7 * i));
  return weeks;
}
/* How far down the window the selected week sits. Rounded because a week
   spanning a daylight-saving change is an hour short of 7 x 86400s. */
function schedWeekIndex(selected) {
  const first = fromYmd(schedAnchor(selected));
  const want = fromYmd(sundayOf(selected));
  return Math.max(0, Math.round((want - first) / (7 * 86400000)));
}
function SchedStripHTML(selected, skipEntryId) {
  const today = localToday();
  let cells = "";
  schedWeekStarts(selected).forEach(function (ws) {
    for (let i = 0; i < 7; i++) {
      const key = addDays(ws, i);
      const d = fromYmd(key);
      /* The entry being edited is left out of its own week strip - showing it
         as an obstacle to itself would be nonsense. */
      const here = scheduleOn(key).filter(e => e.entryId !== skipEntryId);
      const chips = here.slice(0, 2).map(function (e) {
        const r = recipeById(e.recipeId);
        return '<span class="sched-chip">' + esc(r ? r.title : e.title) + '</span>';
      }).join("") + (here.length > 2 ? '<span class="cal-more">+' + (here.length - 2) + '</span>' : "");
      cells += '<button type="button" class="sched-cell' +
        (key === selected ? " on" : "") + (key === today ? " sched-today" : "") + '" ' +
        'onclick="Actions.setScheduleField(\\'date\\',\\'' + key + '\\')">' +
        '<span class="sched-dow">' + DOW[d.getDay()].charAt(0) + '</span>' +
        '<span class="sched-num">' + d.getDate() + '</span>' +
        '<span class="sched-chips">' + chips + '</span>' +
      '</button>';
    }
  });
  return '<div class="sched-strip" id="sched-strip" onscroll="Actions.onSchedScroll(this)">' +
    '<div class="sched-grid">' + cells + '</div></div>';
}

/* The Schedule frame: a day, how many you are feeding, and what that comes to
   in ingredients. Portions here are a count rather than a multiplier - the
   recipe view asks "how many times this recipe", the calendar asks "how many
   people on Tuesday", and the second is the question you actually have. */
function ScheduleModalHTML() {
  const d = state.scheduleDraft || {};
  const editing = !!d.entryId;
  const r = recipeById(d.recipeId);
  if (!r) return modalShell(editing ? "Edit this booking" : "Schedule this recipe",
    '<p class="helper-text">That recipe is no longer in your box.</p>' +
    '<div class="edit-actions"><button class="btn" onclick="Actions.closeModal()">Close</button></div>');
  const base = (Number(r.servings.base) > 0) ? Number(r.servings.base) : 1;
  const serv = Number(d.servings) > 0 ? Number(d.servings) : base;
  const f = serv / base;
  const date = d.date || localToday();
  const ing = (r.ingredients || []).length === 0
    ? '<p class="no-rating">This recipe has no ingredients listed, so it will not add anything to a shopping list.</p>'
    : '<ul class="ing-list">' + r.ingredients.map(function (i) {
        const mv = scaledVal(i.metricValue, f), cv = scaledVal(i.customaryValue, f);
        const alt = (i.customaryValue !== "" && i.customaryValue != null)
          ? ' <span class="alt">(' + formatCustomary(cv, i.customaryUnit) + ')</span>' : "";
        return '<li><span class="ing-amt font-mono">' + formatMetric(mv, i.metricUnit) + alt + '</span>' +
          '<span>' + esc(i.name) + '</span></li>';
      }).join("") + '</ul>';
  /* A dish you are bringing to a community meal sits on the meal's day, and
     the meal's day belongs to whoever is hosting it. So the day picker and
     the week strip both come off and only the servings are left - which are
     yours, and are the number the shopping list actually needs. */
  const meal = editing ? mealForEntry(d.entryId) : null;
  const servingsField =
    '<div class="field"><label>' + esc(r.servings.unit.charAt(0).toUpperCase() + r.servings.unit.slice(1)) + '</label>' +
      '<input type="number" id="sched-servings" min="0.5" step="0.5" value="' + serv + '" ' +
      'onfocus="Actions.onSchedFieldFocus()" ' +
      'onchange="Actions.setScheduleField(\\'servings\\', this.value)" /></div>';
  return modalShell(editing ? "Edit this booking" : "Schedule this recipe",
    '<p class="helper-text"><b>' + esc(r.title) + '</b> — normally makes ' + base + ' ' +
      esc(r.servings.unit) + '. Change the number below and the ingredients follow.</p>' +
    (meal
      ? '<div class="meal-invite"><span class="grow">' + icon("users", 15) +
          ' You are bringing this to <b>' + esc(meal.title) + '</b> on ' +
          esc(shortDate(meal.date)) + '. Only ' + esc(meal.ownerLabel) +
          ' can move the day.</span></div>'
      : SchedStripHTML(date, d.entryId || null)) +
    (meal
      ? '<div id="sched-fields">' + servingsField + '</div>'
      : '<div class="row2" id="sched-fields">' +
          '<div class="field"><label>Day</label>' +
            '<input type="date" id="sched-date" value="' + esc(date) + '" ' +
            'onfocus="Actions.onSchedFieldFocus()" ' +
            'onchange="Actions.setScheduleField(\\'date\\', this.value)" /></div>' +
          servingsField +
        '</div>') +
    '<div class="step-block"><div class="step-label">Ingredients at ' + serv + ' ' +
      esc(r.servings.unit) + '</div>' + ing + '</div>' +
    '<div class="edit-actions"><button class="btn" onclick="Actions.closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="Actions.addToCalendar()">' + icon("calGrid", 15) +
      (editing ? ' Save changes' : ' Add to Calendar') + '</button></div>');
}

function AddGroceryItemModalHTML() {
  return modalShell("Add an item",
    '<p class="helper-text">Anything you need that no recipe called for. The unit is free text — ' +
      '"rolls", "bunches", "tins" are all fine.</p>' +
    '<div class="field"><label>Item</label>' +
      '<input type="text" id="add-groc-name" maxlength="200" placeholder="Paper towels" /></div>' +
    '<div class="row2">' +
      '<div class="field"><label>Quantity (optional)</label>' +
        '<input type="number" step="any" min="0" id="add-groc-qty" placeholder="2" /></div>' +
      '<div class="field"><label>Unit (optional)</label>' +
        '<input type="text" id="add-groc-unit" maxlength="24" placeholder="rolls" /></div>' +
    '</div>' +
    '<div class="edit-actions"><button class="btn" onclick="Actions.closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="Actions.addGroceryItem()">' + icon("plus", 15) +
      ' Add to list</button></div>');
}

/* The generated name says when the list was made, which is the useful thing
   until the day you have two on the go and one of them is Thanksgiving. */
/* The staples list. Shared by the whole cookbook, because whether there is
   salt in the cupboard is a fact about the cupboard. */
function ExclusionsModalHTML() {
  const list = state.exclusionDraft || [];
  const rows = list.length
    ? list.map(function (x, idx) {
        return '<li class="excl-row"><span>' + esc(x) + '</span>' +
          '<button class="icon-btn" title="Take this off the staples list" ' +
            'onclick="Actions.removeExclusion(' + idx + ')">' + icon("x", 15) + '</button></li>';
      }).join("")
    : '<li class="excl-empty">Nothing is being left off. Every ingredient will go on the list.</li>';
  return modalShell("Staples",
    '<p class="helper-text">Things your kitchen always has. Anything here is left off ' +
      '<b>new</b> lists as they are built — lists you already have are not touched. ' +
      'Matching goes on the end of a name, so <b>salt</b> also covers kosher salt and sea salt, ' +
      'while <b>ice</b> leaves ice cream alone.</p>' +
    '<div class="excl-add">' +
      '<input type="text" id="excl-new" maxlength="60" placeholder="Add a staple" ' +
        'onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();Actions.addExclusion();}" />' +
      '<button class="btn btn-sm" onclick="Actions.addExclusion()">' + icon("plus", 14) + ' Add</button>' +
    '</div>' +
    (state.modalError ? '<div class="modal-error">' + esc(state.modalError) + '</div>' : "") +
    '<ul class="excl-list">' + rows + '</ul>' +
    '<div class="edit-actions"><button class="btn" onclick="Actions.closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="Actions.saveExclusions()">Save staples</button></div>');
}

function MergeCommonModalHTML() {
  const plan = state.groceryMergePlan || [];
  const rows = plan.map(function (g, idx) {
    return '<label class="merge-row">' +
        '<input type="checkbox" ' + (g.on ? "checked " : "") +
          'onchange="Actions.toggleMergePlan(' + idx + ')" />' +
        '<span class="merge-body">' +
          '<span class="merge-from">' + g.names.map(esc).join("  +  ") + '</span>' +
          '<span class="merge-into">' + icon("merge", 13) + esc(g.into) + '</span>' +
        '</span>' +
      '</label>';
  }).join("");
  const n = plan.filter(function (g) { return g.on; }).length;
  return modalShell("Merge common ingredients",
    '<p class="helper-text">These look like the same thing spelled two ways. ' +
      'The amounts add up and the name below each pair is the one that stays — you can rename it ' +
      'afterwards by tapping the line. Colours are never folded together, so a red onion and a ' +
      'yellow onion stay apart.</p>' +
    '<div class="merge-rows">' + rows + '</div>' +
    '<div class="edit-actions"><button class="btn" onclick="Actions.closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" ' + (n ? "" : "disabled ") +
      'onclick="Actions.applyMergeCommon()">Merge ' + n + '</button></div>');
}

/* The paragraph that used to sit above every list, on demand. It was five
   lines of screen paid for on every visit to teach something once. */
function GroceryHelpModalHTML() {
  return modalShell("How this list works",
    '<ul class="help-list">' +
      '<li>Tap the <b>tick</b> as you put something in the basket. It folds away under <b>In the basket</b>.</li>' +
      '<li>Tap the <b>name</b> or the <b>amount</b> to open a line: rename it, change either unit, or see which recipe it came from. The two amounts move together.</li>' +
      '<li>Renaming a line changes it here only. The recipe keeps its own wording.</li>' +
      '<li><b>Swipe a line left</b> to remove it — for things you have already got in. It drops under <b>Removed from list</b> and can be put back.</li>' +
      '<li>Drag the <b>dots</b> to put lines in the order of your shop.</li>' +
      '<li><b>Merge common ingredients</b> folds together two spellings of the same thing and adds the amounts up.</li>' +
    '</ul>' +
    '<div class="edit-actions"><button class="btn btn-primary" onclick="Actions.closeModal()">Got it</button></div>');
}

/* The paragraph that used to sit at the top of the Groceries tab. It was four
   lines of standing instruction above the two fields it explains, which is
   three lines too many once you have read it once. */
function GroceriesHelpModalHTML() {
  return modalShell("How groceries work",
    '<ul class="help-list">' +
      '<li>The <b>first</b> and <b>last day</b> are the days you are <b>shopping for</b> — not the day you go.</li>' +
      '<li>Everything on the calendar between those two days, inclusive, is added up into one list.</li>' +
      '<li>That includes dishes you have signed up to bring to a <b>Community Meal</b>, at the servings you committed to.</li>' +
      '<li><b>Staples</b> are the things your kitchen always has. They are left off every new list.</li>' +
      '<li>Building a list twice from the same days gives you the same list again — ticking things off one does not change the other.</li>' +
    '</ul>' +
    '<div class="edit-actions"><button class="btn btn-primary" onclick="Actions.closeModal()">Got it</button></div>');
}

function CalendarHelpModalHTML() {
  return modalShell("How the calendar works",
    '<ul class="help-list">' +
      '<li>Recipes are scheduled from the <b>Recipes tab</b> — open one and use <b>Schedule this recipe</b>.</li>' +
      '<li>Whatever you schedule shows up here, and its ingredients feed the <b>Groceries tab</b> when you build a list for those days.</li>' +
      '<li>A <b>Community Meal</b> is a meal cooked between cookbooks. Invite friends, and everyone says what they are bringing.</li>' +
      '<li>Dishes you sign up to bring land on your own calendar too, <b>in blue</b>, so they reach your shopping list like anything else.</li>' +
      '<li>Tap a day to see everything on it, or to add something to it.</li>' +
    '</ul>' +
    '<div class="edit-actions"><button class="btn btn-primary" onclick="Actions.closeModal()">Got it</button></div>');
}

/* ---- the community meal sheet -----------------------------------------
   Creating and editing are the same form; the difference is whether the
   draft carries a mealId. The guest picker is a list of friend cookbooks,
   because a friendship is what makes somebody invitable and a cookbook is
   what a friendship links. */
/* What the host is bringing, chosen while the meal is still being written.
   The meal does not exist yet, so these are held in the draft and committed
   one by one once it does. Same two-step as the tile: pick a recipe, then say
   how many you are making, because that number is what reaches the shopping
   list. */
function MealDraftDishesHTML() {
  const dr = state.mealDraft;
  const chosen = dr.dishes.length
    ? '<ul class="meal-dishes">' + dr.dishes.map(function (d, i) {
        return '<li class="meal-dish">' +
          '<span class="what">' + esc(d.title) + '</span>' +
          '<span class="meal-dish-who">' + esc(String(d.servings)) + ' ' + esc(d.unit) +
            '<button class="icon-btn" title="Take this off" ' +
            'onclick="Actions.removeMealDraftDish(' + i + ')">' + icon("x", 13) + '</button>' +
          '</span>' +
        '</li>';
      }).join("") + '</ul>'
    : "";
  return '<div class="step-block"><div class="step-label">What you are bringing</div>' +
    chosen +
    '<div class="search-wrap">' +
      '<div class="search-field"><span class="icon">' + icon("search", 18) + '</span>' +
        '<input id="meal-draft-search" type="text" ' +
          'placeholder="Search everyone\\'s recipes..." value="' + esc(dr.search || "") + '" ' +
          'onfocus="Actions.focusMealSearch(\\'meal-draft-search\\')" ' +
          'oninput="Actions.onMealDishInput(\\'draft\\', this.value)" />' +
      '</div>' +
    '</div>' +
    '<div id="meal-results-draft">' + MealDraftResultsHTML() + '</div>' +
  '</div>';
}

function MealDraftResultsHTML() {
  const dr = state.mealDraft;
  if (!dr) return "";
  const pick = dr.pick;
  if (pick) {
    const r = recipeById(pick.recipeId);
    const clash = dr.dishes.filter(function (d) {
      return d.title.trim().toLowerCase() === pick.title.trim().toLowerCase();
    }).length;
    return (clash
      ? '<div class="meal-dup">You already have ' + esc(pick.title) + ' on the list.</div>' : "") +
      '<div class="meal-dish-pick">' +
        '<span class="name">' + esc(pick.title) + '</span>' +
        '<input type="number" step="any" min="0" id="meal-serv-draft" ' +
          'aria-label="How many ' + esc(r ? r.servings.unit : "servings") + '" ' +
          'value="' + esc(String(pick.servings)) + '" />' +
        '<span class="unit">' + esc(r ? r.servings.unit : "servings") + '</span>' +
        '<button class="btn btn-sm btn-meal" onclick="Actions.addMealDraftDish()">' +
          icon("plus", 14) + ' Add</button>' +
        '<button class="icon-btn" title="Pick something else" ' +
          'onclick="Actions.clearMealDishPick(\\'draft\\')">' + icon("x", 15) + '</button>' +
      '</div>';
  }
  const q = String(dr.search || "");
  if (!q.trim()) return "";
  const all = mealDishMatches(q);
  if (all.length === 0) return '<p class="no-rating">Nothing matches "' + esc(q.trim()) + '".</p>';
  return '<ul class="groc-list">' + all.slice(0, MEAL_RESULT_MAX).map(function (r) {
      return '<li class="groc-entry">' +
        '<button class="groc-entry-main" onclick="Actions.pickMealDish(\\'draft\\',\\'' +
          r.recipeId + '\\')">' +
          '<div class="groc-entry-label">' + esc(r.title) + '</div>' +
          '<div class="groc-entry-sub">' + esc(r.household) + '</div>' +
        '</button>' +
        '<button class="groc-entry-plus" aria-label="Bring ' + esc(r.title) + '" ' +
          'onclick="Actions.pickMealDish(\\'draft\\',\\'' + r.recipeId + '\\')">' +
          icon("plus", 16) + '</button>' +
      '</li>';
    }).join("") + '</ul>' +
    (all.length > MEAL_RESULT_MAX
      ? '<p class="no-rating">' + (all.length - MEAL_RESULT_MAX) + ' more — keep typing.</p>' : "");
}

/* The guest list, for both sheets that ask for one. A cookbook of friends
   gets long enough to bury the rest of the form, so it searches the way the
   Whose recipes picker does and scrolls three rows at a time. The already
   argument maps a label to the status of somebody the meal has - those
   rows are shown but inert, so the list reads as the whole guest list rather
   than as a puzzle about who is missing from it. */
function MealFriendPickerHTML(already) {
  const dr = state.mealDraft;
  if (!state.friends.length) {
    return '<p class="helper-text">No friends yet. Add someone on the Friends page first — a ' +
      'community meal is cooked between cookbooks that are already linked.</p>';
  }
  const q = (state.mealFriendSearch || "").trim().toLowerCase();
  const picked = {};
  ((dr && dr.guests) || []).forEach(function (u) { picked[u.toLowerCase()] = 1; });
  const rows = state.friends.map(function (f) {
    /* One row per cookbook, keyed on any one of its members - inviting a
       cookbook invites everybody in it, which is what the sub-line says
       where a cookbook has more than one person in it. */
    const key = f.members[0] || "";
    if (!key) return "";
    if (q && f.label.toLowerCase().indexOf(q) < 0) return "";
    const settled = already && already[f.label];
    if (settled) {
      return '<div class="pick-row" style="opacity:.55">' + esc(f.label) +
        '<div class="friend-sub">' +
          (settled === "accepted" ? "Already coming" : settled === "owner" ? "Hosting" : "Already asked") +
        '</div></div>';
    }
    const on = !!picked[key.toLowerCase()];
    return '<button class="pick-row' + (on ? " on" : "") + '" ' +
      'onclick="Actions.toggleMealGuest(\\'' + esc(key) + '\\')">' +
      esc(f.label) +
      (f.members.length > 1
        ? '<div class="friend-sub">One cookbook — all of them are invited</div>' : "") +
    '</button>';
  }).join("");
  return '<input type="text" id="meal-friend-search" autocomplete="off" ' +
      'placeholder="Search friends..." value="' + esc(state.mealFriendSearch || "") + '" ' +
      'oninput="Actions.mealFriendSearch(this.value)" />' +
    '<div class="pick-list pick-list-3">' +
      (rows ||
        (q ? '<p class="helper-text">No one by that name.</p>'
           : '<p class="helper-text">Nobody left to invite.</p>')) + '</div>';
}

function MealModalHTML() {
  const dr = state.mealDraft;
  if (!dr) return modalShell("Community Meal", "");
  const editing = !!dr.mealId;
  return modalShell(editing ? "Edit this meal" : "New Community Meal",
    (state.modalError ? '<div class="modal-error">' + esc(state.modalError) + '</div>' : "") +
    '<div class="field"><label>What is it called</label>' +
      '<input type="text" id="meal-title" maxlength="120" placeholder="Sunday cookout" ' +
        'value="' + esc(dr.title) + '" /></div>' +
    /* Both optional. A meal with a name and a day is already a meal; these
       two only save somebody asking in a group chat. */
    '<div class="field"><label>Anything to say about it (optional)</label>' +
      '<textarea id="meal-desc" rows="2" maxlength="500" ' +
        'placeholder="Bring a chair — we are eating outside">' + esc(dr.description || "") + '</textarea></div>' +
    '<div class="field"><label>Where (optional)</label>' +
      '<input type="text" id="meal-loc" maxlength="200" placeholder="Ours, or 12 Elm St" ' +
        'value="' + esc(dr.location || "") + '" /></div>' +
    '<div class="groc-range">' +
      '<div class="field"><label>Day</label>' +
        '<input type="date" id="meal-date" value="' + esc(dr.date) + '" /></div>' +
      '<div class="field"><label>Time</label>' +
        '<input type="time" id="meal-time" value="' + esc(dr.time) + '" /></div>' +
    '</div>' +
    '<div class="step-block"><div class="step-label">Who to invite</div>' +
      MealFriendPickerHTML(null) +
    '</div>' +
    (editing ? "" : MealDraftDishesHTML()) +
    (editing
      ? '<p class="helper-text">Moving the day moves everyone\\'s dishes with it, on their ' +
          'calendars as well as yours.</p>'
      : '<p class="helper-text">You can say what you are bringing once the meal exists — and ' +
          'so can everyone who accepts.</p>') +
    '<div class="edit-actions">' +
      '<button class="btn" onclick="Actions.closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="Actions.saveMeal()">' +
        (editing ? "Save changes" : "Create meal") + '</button>' +
    '</div>');
}

/* Inviting more people to a meal that already exists. Anyone already on it
   is shown but not selectable, so the list reads as the whole guest list
   rather than as a puzzle about who is missing from it. */
function MealGuestsModalHTML() {
  const m = mealById(state.mealDraft && state.mealDraft.mealId);
  if (!m) return modalShell("Invite", "");
  const already = {};
  m.guests.forEach(function (g) { already[g.label] = g.status; });
  return modalShell("Invite to " + m.title,
    (state.modalError ? '<div class="modal-error">' + esc(state.modalError) + '</div>' : "") +
    MealFriendPickerHTML(already) +
    '<div class="edit-actions">' +
      '<button class="btn" onclick="Actions.closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="Actions.sendMealInvites()">Send invitations</button>' +
    '</div>');
}

function RenameListModalHTML() {
  const L = state.pendingRenameList;
  const meta = state.groceryLists.filter(x => x.listId === L)[0];
  return modalShell("Rename this list",
    '<div class="field"><label>Name</label>' +
      '<input type="text" id="rename-list" maxlength="120" value="' + esc(meta ? meta.label : "") + '" /></div>' +
    '<p class="helper-text">Leave it empty to go back to the date-stamped name.</p>' +
    '<div class="edit-actions"><button class="btn" onclick="Actions.closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="Actions.saveListName()">Save name</button></div>');
}

function ConfirmDeleteListModalHTML() {
  const L = state.pendingDeleteList;
  const meta = state.groceryLists.filter(x => x.listId === L)[0];
  return modalShell("Delete this list?",
    '<p class="helper-text">' + esc(meta ? meta.label : "This list") + ' will be deleted, along with ' +
      'anything you had ticked off on it. The calendar and the recipes are untouched, so you can build ' +
      'the same list again from the same dates.</p>' +
    '<div class="edit-actions"><button class="btn" onclick="Actions.closeModal()">Keep it</button>' +
    '<button class="btn btn-primary" onclick="Actions.confirmDeleteList()">' + icon("trash", 15) +
      ' Delete list</button></div>');
}

function ImportModalHTML() {
  const parsed = state.importParsed;
  let summary = "";
  if (parsed.length || state.importErrors.length) {
    summary = '<div class="import-summary">' +
      '<div>' + parsed.length + ' recipe(s) read.</div>' +
      (state.importErrors.length ? '<div style="color:var(--accent);margin-top:4px">' + icon("alert", 13) +
        ' Couldn\\'t read line(s) ' + state.importErrors.join(", ") + ' — usually curly “smart quotes” from a keyboard or notes app.</div>' : "") +
      (parsed.length ? '<ul>' + parsed.map(p => '<li>' + esc(p.body.title) + '</li>').join("") + '</ul>' : "") +
    '</div>';
  }
  return modalShell("Import recipes",
    '<p class="helper-text">Paste from your clipboard, or choose a file — one JSON recipe per line. Every imported recipe is added to your cookbook with a new recipe ID.</p>' +
    '<div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">' +
      '<button class="btn" style="flex:1; min-width:140px" onclick="Actions.pasteImportFile()">' + icon("copy", 16) + ' Paste recipes</button>' +
      '<label class="btn" style="flex:1; min-width:140px; text-align:center; cursor:pointer;">' + icon("upload", 16) + ' Choose a file' +
        '<input type="file" accept=".jsonl,.txt,.json" style="display:none" onchange="Actions.handleImportFile(this)" /></label>' +
    '</div>' +
    (state.importFileName ? '<p class="helper-text">Source: ' + esc(state.importFileName) + '</p>' : "") +
    summary +
    '<div class="field"><label>Who can see these recipes</label><div class="seg">' +
      '<button class="' + (state.importVisibility === "private" ? "active" : "") + '" onclick="Actions.setImportVisibility(\\'private\\')">' + icon("lock", 15) + ' ' + privateLabel() + '</button>' +
      '<button class="' + (state.importVisibility === "friends" ? "active" : "") + '" onclick="Actions.setImportVisibility(\\'friends\\')">' + icon("globe", 15) + ' All friends</button>' +
    '</div></div>' +
    '<button class="btn btn-primary btn-block" ' + (parsed.length === 0 || !state.importVisibility ? "disabled" : "") +
      ' onclick="Actions.confirmImport()">Import ' + (parsed.length || "") + ' recipe' + (parsed.length === 1 ? "" : "s") + '</button>');
}

function UrlToRecipeModalHTML() {
  const u = state.urlToRecipe;
  const src = IMPORT_SOURCES[u.mode] || IMPORT_SOURCES.url;
  let step1;
  if (u.mode === "url") {
    step1 = '<div class="step-label">1. Paste the recipe URL</div>' +
      '<input type="url" id="utr-url" placeholder="https://..." value="' + esc(u.url) + '" style="width:100%; padding:9px 10px; border-radius:8px; border:1px solid var(--border); font-size:14.5px" />';
  } else if (u.mode === "text") {
    step1 = '<div class="step-label">1. Paste the recipe text</div>' +
      '<textarea class="response-box" id="utr-text" placeholder="Paste the whole recipe here - ingredients, steps, whatever you have...">' + esc(u.text) + '</textarea>' +
      '<p class="helper-text">Anything readable will do: an email, a screenshot you have already transcribed, a note off a packet. It goes on the end of the prompt.</p>';
  } else {
    step1 = '<div class="step-label">1. Get the prompt</div>' +
      '<p class="helper-text">' + (u.mode === "photo"
        ? "Copy this prompt into Claude, ChatGPT or Grok and attach your photo of the recipe in the same message."
        : "Copy this prompt into the conversation where you have been working out the recipe, as your next message.") +
      '</p>';
  }
  return modalShell(src.label,
    '<div class="step-block">' + step1 +
      '<button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="Actions.generatePrompt()">Generate prompt</button>' +
    '</div>' +
    (u.generated ?
      '<div class="step-block"><div class="step-label">2. Copy into Claude (or another AI)</div>' +
        '<textarea class="prompt-box" id="utr-prompt" readonly>' + esc(u.prompt) + '</textarea>' +
        '<button class="btn btn-sm" style="margin-top:8px" onclick="Actions.copyPrompt()">' + icon("copy", 14) + ' Copy prompt</button>' +
      '</div>' +
      '<div class="step-block"><div class="step-label">3. Paste the answer here</div>' +
        '<textarea class="response-box" id="utr-response" placeholder="Paste the single-line JSON the AI gives you..."></textarea>' +
        '<button class="btn btn-primary" style="margin-top:8px" onclick="Actions.loadPastedResponse()">Fill in the form</button>' +
        '<p class="helper-text" style="margin-top:8px">This fills the new-recipe form so you can check it and choose private or shared before it saves.</p>' +
      '</div>' : ""));
}

function AccountModalHTML() {
  return modalShell("Settings",
    '<div class="field"><label>Your name</label>' +
      '<input type="text" id="set-name" autocapitalize="none" autocorrect="off" spellcheck="false" value="' + esc(state.session.username) + '" />' +
      '<button class="btn btn-sm btn-block" onclick="Actions.saveUsername()">Save name</button>' +
      '<p class="helper-text">This is what friends see on your recipes, ratings and comments. 2-20 characters: letters, numbers, dot, dash or underscore.</p>' +
    '</div>' +
    (state.mates.length
      ? '<div class="field"><label>In this cookbook with you</label>' +
        state.mates.map(m => '<div class="friend-row"><span style="color:var(--accent)">' + icon("chain", 16) + '</span>' +
          '<div class="friend-name">' + esc(m) + '</div></div>').join("") + '</div>'
      : "") +
    '<div class="field"><label>Cookbook ID</label>' +
      '<div class="code-box font-mono">' + esc(state.session.cookbookId) + '</div>' +
      '<button class="btn btn-sm btn-block" onclick="Actions.copyCookbookId()">' + icon("copy", 14) + ' Copy Cookbook ID</button>' +
    '</div>' +

    '<div class="warn-box">Anyone with this Cookbook ID can read, edit and delete every recipe in it, and inherits every friendship it has. Give it only to someone you cook with, or use it to open this cookbook on another of your devices — to share recipes with anyone else, add them as a friend instead.</div>' +

    '<details class="adm"><summary>Maintenance</summary>' +
      '<p class="helper-text">One-time tag migration. It rewrites recipe tags in <b>every</b> cookbook into the ' +
        'current tag list. Check the dry run before applying.</p>' +
      '<div class="field"><label>Admin token</label>' +
        '<input type="password" id="adm-token" autocomplete="off" autocapitalize="none" spellcheck="false" ' +
          'placeholder="from the Worker variables" /></div>' +
      '<div style="display:flex; gap:8px">' +
        '<button class="btn btn-sm" onclick="Actions.runRetag(false)">Dry run</button>' +
        '<button class="btn btn-sm btn-primary" onclick="Actions.runRetag(true)">Apply</button>' +
      '</div>' +
      '<div class="adm-out" id="adm-out">Not run yet.</div>' +
    '</details>' +
    '<button class="btn btn-block" onclick="Actions.signOut()">' + icon("logout", 15) + ' Sign out on this device</button>');
}

function LockedModalHTML() {
  const l = state.lockedInfo || { who: "Someone", since: "", freeIn: 0 };
  const at = fmtTime(l.since);
  const mins = Math.ceil((l.freeIn || 0) / 60);
  return modalShell("Currently being edited",
    '<p class="helper-text"><b>' + esc(l.who) + '</b> opened this recipe in the editor' + (at ? " at " + esc(at) : "") +
      ', so it is locked to avoid you both changing it at once.' +
      (mins > 0 ? ' If they have put their phone down, it unlocks on its own in about ' + mins + ' minute' + (mins === 1 ? "" : "s") + '.' : '') +
      '</p>' +
    '<div style="display:flex; flex-direction:column; gap:8px;">' +
      '<button class="btn btn-primary btn-block" onclick="Actions.dismissLock()">Wait for ' + esc(l.who) + '</button>' +
      '<button class="btn btn-block" onclick="Actions.takeOverLock()">Take over anyway</button>' +
    '</div>' +
    '<p class="helper-text" style="margin-top:12px">Taking over does not throw their work away — if they save afterwards they will be told first.</p>');
}

function ConflictModalHTML() {
  const c = state.conflict || { who: "Someone", when: "" };
  const at = fmtTime(c.when);
  return modalShell("Saved by someone else",
    '<p class="helper-text">' + esc(c.who) + ' saved changes to this recipe' + (at ? " at " + esc(at) : "") +
      ', after you started editing. Nothing has been overwritten yet.</p>' +
    '<div style="display:flex; flex-direction:column; gap:8px;">' +
      '<button class="btn btn-primary btn-block" onclick="Actions.resolveConflict(\\'mine\\')">Keep mine, overwrite theirs</button>' +
      '<button class="btn btn-block" onclick="Actions.resolveConflict(\\'theirs\\')">Discard mine, load theirs</button>' +
      '<button class="btn btn-block btn-ghost" onclick="Actions.resolveConflict(\\'stay\\')">Back to my edits</button>' +
    '</div>');
}

/* Neither code acts on its own. A recipe code asks its owner to be friends,
   which is a thing done in somebody else's name, so it gets a yes first. */
/* Only the friend code raises this now. A recipe link opens the recipe
   itself, so the recipe branch that used to live here is gone. */
function ConfirmIntentModalHTML() {
  const c = state.intent || {};
  return modalShell("Add a friend",
    (state.modalError ? '<div class="modal-error">' + esc(state.modalError) + '</div>' : "") +
    '<p style="margin:0 0 14px">Send <b>' + esc(c.name || "") + '</b> a friend request?</p>' +
    '<p class="helper-text">They have to accept before either of you sees the other\\'s shared recipes. ' +
    'Friendships link whole cookbooks, so anyone sharing theirs comes with them.</p>' +
    '<div style="display:flex; gap:8px; margin-top:16px">' +
      '<button class="btn btn-primary" style="flex:1" ' + (state.busy ? "disabled" : "") +
        ' onclick="Actions.runIntent()">' + icon("userPlus", 15) + ' Send request</button>' +
      '<button class="btn" onclick="Actions.dismissIntent()">Not now</button>' +
    '</div>');
}

/* Who can reach this recipe, as three rungs of a ladder. Selective opens a
   list of friends underneath it, because picking that tier without picking
   anybody would leave the recipe reaching nobody at all. */
function VisibilityModalHTML() {
  const r = getActiveRecipe();
  if (!r || !r.ours) return modalShell("Who can see this", "");
  const v = r.visibility;
  const row = function (tier, blurb) {
    return '<button class="vis-row' + (v === tier ? " on" : "") + '" ' +
      'onclick="Actions.setVisibility(\\'' + tier + '\\')">' +
      '<div class="vis-row-head">' + visibilityIcon(tier, 15) + ' ' + esc(visibilityLabel(tier)) + '</div>' +
      '<div class="vis-row-sub">' + blurb + '</div>' +
    '</button>';
  };
  const chosen = state.visDraft || [];
  const picker = v !== "selective" ? "" :
    (!state.friends.length
      ? '<p class="helper-text">No friends yet, so there is nobody to hand it to. It stays inside your cookbook until you add one.</p>'
      : '<div class="section-label">Hand it to</div>' +
        '<div>' + state.friends.map(function (f, i) {
          const on = chosen.indexOf(f.members[0] || "") >= 0;
          return '<label class="share-row"><input type="checkbox"' + (on ? " checked" : "") +
            ' onchange="Actions.toggleVisShare(' + i + ')" /> ' + esc(f.label) + '</label>';
        }).join("") + '</div>');
  return modalShell("Who can see this",
    '<div class="vis-rows">' +
      row("private", "Only your cookbook. No link and no code — this one does not leave the house.") +
      row("selective", "Your cookbook, plus the friends you tick. Can be handed out by link or code.") +
      row("friends", "Every friend of your cookbook. Can be handed out by link or code.") +
    '</div>' + picker);
}

/* A recipe somebody was sent. Readable with no account at all, which is the
   point: the person you handed the link to should be able to cook from it
   before deciding whether they want a cookbook of their own. What is missing
   compared with the ordinary detail view is deliberate - no marks, no
   scheduling and no cook log, because all of those are things you do to your
   own box or say to a friend, and a link holder is neither yet. */
/* The same four things you can do to a recipe in your own box, offered on a
   recipe that arrived by link or code. They are drawn for everybody and work
   for account holders only: a reader with no cookbook sees them greyed, which
   is a truer answer than an empty space to "what happens if I tap that".
   Not MARK_DEFS through MarkButtonsHTML because that one toggles against a
   recipe already in the library, and this one has to take the recipe into the
   library first - a different call with a different failure mode. */
function LinkMarkButtonsHTML(lr, mine) {
  const signedIn = !!state.session;
  const dead = !signedIn || state.busy;
  const btn = function (cls, kind, glyph, label, on, call) {
    return '<button class="mark ' + cls + (on ? " on" : "") + '" title="' + label + '"' +
      (dead ? " disabled" : ' onclick="' + call + '"') + '>' +
      icon(glyph, 15) + '<span>' + label + '</span></button>';
  };
  let out = "";
  MARK_DEFS.forEach(function (d) {
    /* Pinning a recipe you already own is meaningless, exactly as it is in
       the library. Favourite and Save for later still mean something. */
    if (d[0] === "pin" && mine) return;
    const on = signedIn && isMarked(d[0], lr.recipeId);
    out += btn("mark-" + d[0], d[0], d[1], on ? d[3] : d[2], on,
      "Actions.markFromLink(\\'" + d[0] + "\\')");
  });
  out += btn("mark-cal", "cal", "calGrid", "Schedule this recipe", false,
    "Actions.scheduleFromLink()");
  return out;
}

function LinkRecipeViewHTML() {
  const signedIn = !!state.session;
  const back = signedIn
    ? '<button class="back-link" onclick="Actions.leaveLinkView()">' + icon("chevronLeft", 18) + ' Recipe box</button>'
    : '<button class="back-link" onclick="Actions.leaveLinkView()">' + icon("chevronLeft", 18) + ' Account Login</button>';
  if (!state.linkRecipe) {
    return '<div class="wrap"><div class="detail-top">' + back + '</div>' +
      '<p style="padding-top:24px">' + esc(state.linkError || "That link could not be opened.") + '</p>' +
      (signedIn ? "" : '<p class="helper-text">If you have a cookbook, sign in and try the link again.</p>') +
    '</div>';
  }
  const lr = state.linkRecipe;
  const r = lr.body;
  const mine = signedIn && state.recipes.some(function (x) { return x.recipeId === lr.recipeId && x.ours; });
  const already = signedIn && state.recipes.some(function (x) { return x.recipeId === lr.recipeId; });
  /* Tapping the author asks to be friends. Only offered to somebody who has
     an account and is not already linked to them - otherwise it is either
     meaningless or already done. */
  const known = signedIn && state.friends.some(function (f) { return f.label === lr.household; });
  const credit = (signedIn && !mine && !known)
    ? '<button class="owner-badge owner-badge-btn" onclick="Actions.askToBeFriends(\\'' + esc(lr.owner) + '\\')">' +
        'from ' + esc(lr.household) + ' ' + icon("userPlus", 11) + '</button>'
    : '<span class="owner-badge">from ' + esc(lr.household) + '</span>';
  const pinRow = '<div class="detail-marks">' + LinkMarkButtonsHTML(lr, mine) + '</div>' +
    (signedIn && mine ? '<p class="helper-text">This one is already yours.</p>'
      : signedIn && already ? '<p class="helper-text">Already in your cookbook.</p>' : "");
  const joinRow = signedIn ? "" :
    '<div class="link-join">' +
      '<p class="helper-text" style="margin:0 0 8px">You are reading this without an account. ' +
      'A cookbook of your own lets you favourite this recipe, put it on a calendar, ' +
      'cook from it and keep your own notes.</p>' +
      '<button class="btn btn-primary btn-block" onclick="Actions.leaveLinkView()">Make a cookbook</button>' +
    '</div>';
  const tags = r.tags && r.tags.length
    ? '<div class="detail-tags">' + r.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join("") + '</div>'
    : "";
  return '' +
    '<div class="wrap">' +
      '<div class="detail-top">' + back + '</div>' +
      '<h1 class="detail-title font-display">' + esc(r.title) + '</h1>' +
      '<div class="detail-meta" style="margin-bottom:10px">' + credit + '</div>' +
      pinRow +
      joinRow +
      ShareBlockHTML(lr.recipeId, lr.visibility, false) +
      tags +
      '<div id="recipe-body">' + RecipeBodyHTML(r, true) + '</div>' +
    '</div>';
}

/* Link and code, side by side, carrying the same URL. Private recipes get
   neither: there is nothing to hand out, and offering a code for something
   nobody else can open would only mislead. */
function ShareBlockHTML(recipeId, visibility, ours) {
  if (!(visibility === "friends" || visibility === "selective")) {
    return ours
      ? '<p class="helper-text" style="margin:14px 0 16px">This one is ' + esc(privateLabel().toLowerCase()) +
        ', so it has no link or code. Change who can see it to share it.</p>'
      : "";
  }
  const shareUrl = recipeQrUrl(recipeId);
  return '<div class="qr-share" style="margin:14px 0 16px">' +
      '<div class="qr-side-text">' +
        '<div class="small-label" style="margin-bottom:5px">Share Recipe</div>' +
        '<div class="code-box font-mono">' + esc(shareUrl) + '</div>' +
        '<button class="btn btn-sm btn-block" onclick="Actions.copyRecipeUrl(\\'' + recipeId + '\\')">' +
          icon("copy", 14) + ' Copy link</button>' +
      '</div>' +
      '<div class="qr-holder">' + recipeQrHTML(recipeId, 112) + '</div>' +
    '</div>';
}

function ActionsModalHTML() {
  const alerts = state.incoming.length + unreadNotifications().length;
  return modalShell("Actions",
    '<div style="display:flex; flex-direction:column; gap:8px;">' +
      '<button class="btn btn-primary btn-block" onclick="Actions.closeModal(); Actions.openNew();">' + icon("plus", 16) + ' New recipe</button>' +
      '<button class="btn btn-block" onclick="Actions.closeModal(); Actions.openFriends();">' + icon("users", 16) + ' Friends/Notifications' + (alerts ? " (" + alerts + ")" : "") + '</button>' +
      '<button class="btn btn-block" onclick="Actions.closeModal(); Actions.openModal(\\'import\\');">' + icon("upload", 16) + ' Import recipes</button>' +
      '<button class="btn btn-block" onclick="Actions.closeModal(); Actions.exportAll();">' + icon("download", 16) + ' Export ' + (hasActiveFilter() ? "selected" : "all") + '</button>' +
      '<button class="btn btn-block" onclick="Actions.closeModal(); Actions.reload();">' + icon("sync", 16) + ' Reload from server</button>' +
      '<button class="btn btn-block" onclick="Actions.closeModal(); Actions.openModal(\\'shareApp\\');">' + icon("share", 16) + ' Share App</button>' +
      '<button class="btn btn-block" onclick="Actions.closeModal(); Actions.openModal(\\'account\\');">' + icon("lock", 16) + ' Settings</button>' +
    '</div>');
}

/* Nothing left to pin. The page beneath cannot move while a modal is up
   because #app is the only scroller and the modal is not inside it.
   This used to set the body to fixed with a negative top and put the scroll
   position back on close, which is what the app-shell layout now does for
   free - and without the jump that came from taking the body out of flow.
   The attribute stays as a hook for CSS and for anything that wants to ask
   whether a modal is up. */
/* Publishes the on-screen viewport to CSS as --vv-*. Everything a fixed
   overlay needs comes from one object read at one moment, so nothing can
   drift out of step. offsetTop is what the visible area has slid down by,
   which is the right value for a fixed element's top because fixed positions
   against the layout viewport.
   Also worth having for its own sake: while the keyboard is up, vv.height
   stops above it, so a modal centres in the room that is left rather than
   sitting half underneath the keys. */
function syncViewportVars() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv || !root) return;
  root.style.setProperty("--vv-top", vv.offsetTop + "px");
  root.style.setProperty("--vv-left", vv.offsetLeft + "px");
  root.style.setProperty("--vv-width", vv.width + "px");
  root.style.setProperty("--vv-height", vv.height + "px");
}

/* The band along the foot of a home-screen app is iOS chrome, not page. It
   lives outside the web view, so no stylesheet reaches it - iOS fills it from
   the theme colour instead. At the page cream it is invisible in normal use,
   which is why it went unnoticed, and obvious the moment a modal dims
   everything except it.
   Repainting it with the colour the overlay composites to closes the seam:
   cream under rgba(34,31,28,.5) is #8a867e. Elsewhere the tag only tints
   browser chrome that is already the right colour, so this costs nothing. */
const CHROME_REST = "#f2ede1";
const CHROME_DIMMED = "#8a867e";
function setChromeTint(dim) {
  if (typeof document === "undefined") return;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", dim ? CHROME_DIMMED : CHROME_REST);
}

/* One place that knows which layout is up, and three that read and write
   scroll through it. Nothing else should reach for #app directly: it is the
   scroller in the installed app only, and the document is the scroller in a
   tab. The class is put on <html> in the head before first paint. */
function docScrolls() {
  return typeof document !== "undefined" && !!document.documentElement &&
    document.documentElement.classList.contains("doc-scroll");
}
function scrollBox() { return docScrolls() ? null : document.getElementById("app"); }
function scrollAt() {
  const el = scrollBox();
  if (el) return el.scrollTop;
  if (typeof window === "undefined") return 0;
  return window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
}
function scrollToY(y) {
  const el = scrollBox();
  if (el) el.scrollTop = y;
  else if (typeof window !== "undefined") window.scrollTo(0, y);
}
function scrollRoom() {
  const el = scrollBox();
  if (el) return el.scrollHeight - el.clientHeight;
  if (typeof window === "undefined") return 0;
  const d = document.documentElement, b = document.body;
  return Math.max(d ? d.scrollHeight : 0, b ? b.scrollHeight : 0) - window.innerHeight;
}

let lockedScrollAt = 0;
function setScrollLock(want) {
  const b = document.body;
  if (!b) return;
  setChromeTint(!!want);
  if (want) {
    /* Re-measured on the way in, then kept current by the listeners in the
       init block for as long as the modal is up. */
    syncViewportVars();
    /* In a tab the document underneath is live, so it has to be pinned or
       the library scrolls behind the dialog. Fixing the body takes it out of
       flow, which would otherwise snap the page to the top - hence holding
       the offset on the way in and putting it back on the way out. Guarded
       on the attribute because renderModal runs setScrollLock on every
       repaint, and a modal redrawing itself must not re-read the offset as
       zero while the body is already fixed.
       The installed app has nothing to pin - #app is the scroller and the
       modal is not inside it - so there the attribute stays what it was, a
       bare hook for CSS. */
    if (docScrolls() && !b.hasAttribute("data-scroll-lock")) {
      lockedScrollAt = scrollAt();
      b.style.top = (-lockedScrollAt) + "px";
    }
    b.setAttribute("data-scroll-lock", "1");
  } else {
    const wasLocked = b.hasAttribute("data-scroll-lock");
    b.removeAttribute("data-scroll-lock");
    if (docScrolls() && wasLocked) {
      b.style.top = "";
      scrollToY(lockedScrollAt);
    }
  }
}

function renderModal() {
  const root = document.getElementById("modal-root");
  setScrollLock(!!state.modal);
  if (!state.modal) { root.innerHTML = ""; return; }
  if (state.modal === "logCook") root.innerHTML = LogCookModalHTML();
  else if (state.modal === "import") root.innerHTML = ImportModalHTML();
  else if (state.modal === "urlToRecipe") root.innerHTML = UrlToRecipeModalHTML();
  else if (state.modal === "account") root.innerHTML = AccountModalHTML();
  else if (state.modal === "shareApp") root.innerHTML = ShareAppModalHTML();
  else if (state.modal === "confirmIntent") root.innerHTML = ConfirmIntentModalHTML();
  else if (state.modal === "visibility") root.innerHTML = VisibilityModalHTML();
  else if (state.modal === "owner") root.innerHTML = OwnerModalHTML();
  else if (state.modal === "filters") { root.innerHTML = FiltersModalHTML(); updateFilterScrollHint(); }
  else if (state.modal === "actions") root.innerHTML = ActionsModalHTML();
  else if (state.modal === "schedule") root.innerHTML = ScheduleModalHTML();
  else if (state.modal === "calDay") root.innerHTML = CalDayModalHTML();
  else if (state.modal === "confirmDeleteList") root.innerHTML = ConfirmDeleteListModalHTML();
  else if (state.modal === "addGroceryItem") root.innerHTML = AddGroceryItemModalHTML();
  else if (state.modal === "renameList") root.innerHTML = RenameListModalHTML();
  else if (state.modal === "groceryHelp") root.innerHTML = GroceryHelpModalHTML();
  else if (state.modal === "groceriesHelp") root.innerHTML = GroceriesHelpModalHTML();
  else if (state.modal === "calendarHelp") root.innerHTML = CalendarHelpModalHTML();
  else if (state.modal === "meal") root.innerHTML = MealModalHTML();
  else if (state.modal === "mealGuests") root.innerHTML = MealGuestsModalHTML();
  else if (state.modal === "mergeCommon") root.innerHTML = MergeCommonModalHTML();
  else if (state.modal === "exclusions") root.innerHTML = ExclusionsModalHTML();
  else if (state.modal === "conflict") root.innerHTML = ConflictModalHTML();
  else if (state.modal === "locked") root.innerHTML = LockedModalHTML();
}

/* ====================================================================== */
/* Main render                                                             */
/* ====================================================================== */
/* A render that throws leaves whatever was on screen before it, which on
   first load is nothing at all - a white page with no clue what went wrong.
   That is exactly the failure that is hardest to report and hardest to
   diagnose, so the outer render says so instead of dying quietly. */
function renderApp() {
  try { renderAppInner(); }
  catch (e) {
    const app = document.getElementById("app");
    if (app) {
      app.innerHTML = '<div class="wrap"><h1 class="detail-title font-display">Something broke</h1>' +
        '<p class="helper-text">The page could not be drawn. This is a bug worth reporting.</p>' +
        '<div class="code-box font-mono" style="text-align:left;word-break:break-word">' +
          esc(String((e && e.message) || e)) + '</div>' +
        '<button class="btn btn-primary btn-block" style="margin-top:12px" ' +
          'onclick="Actions.recoverFromError()">Start again</button></div>';
    }
    throw e;   /* still reaches the console for anyone looking */
  }
}
function renderAppInner() {
  const app = document.getElementById("app");
  /* A share link is readable before there is an account, so this comes ahead
     of the sign-in wall rather than behind it. */
  if (state.view === "link") {
    app.innerHTML = LinkRecipeViewHTML();
    renderTabBar();
    renderModal();
    return;
  }
  if (!state.session) { app.innerHTML = WelcomeViewHTML(); renderTabBar(); renderModal(); return; }
  if (state.loading) { app.innerHTML = '<div class="loading">Loading your recipe box…</div>'; renderTabBar(); renderModal(); return; }
  if (state.view === "library") app.innerHTML = LibraryViewHTML();
  else if (state.view === "detail") app.innerHTML = DetailViewHTML(getActiveRecipe());
  else if (state.view === "friends") app.innerHTML = FriendsViewHTML();
  else if (state.view === "edit") app.innerHTML = EditViewHTML();
  else if (state.view === "calendar") app.innerHTML = CalendarViewHTML();
  else if (state.view === "groceries") app.innerHTML = GroceriesViewHTML();
  else if (state.view === "grocery") app.innerHTML = GroceryListViewHTML();
  renderTabBar();
  renderModal();
  if (state.view === "calendar") placeCalendarScroll();
  placeSchedStrip();
}

/* The three-week box opens on this week, which is row calBack of the window.
   Done after the markup lands rather than inside it, since it is a scroll
   position and there is no way to express one in HTML. */
/* The strip opens on the week holding the selected day, and stays where it
   was put once the person has scrolled it themselves. */
function placeSchedStrip() {
  const box = document.getElementById("sched-strip");
  if (!box) return;
  const d = state.scheduleDraft;
  box.scrollTop = (state.schedWeekTop == null)
    ? schedWeekIndex((d && d.date) || localToday()) * SCHED_ROW
    : state.schedWeekTop;
}
function placeCalendarScroll() {
  const box = document.getElementById("cal-scroll");
  if (!box) return;
  box.scrollTop = (state._calTop == null)
    ? Math.max(0, (state.calBack - 1) * CAL_ROW)
    : state._calTop;
}

/* ====================================================================== */
/* Actions                                                                 */
/* ====================================================================== */
const Actions = {};

/* --- session --- */
Actions.regenerateCookbook = function() {
  state._wUsername = document.getElementById("w-username").value;
  state._wCookbook = randomCookbookId();
  state.modalError = "";
  renderApp();
};
Actions.copyCookbookField = async function() {
  const v = document.getElementById("w-cookbook").value.trim().toUpperCase();
  try { await navigator.clipboard.writeText(v); toast("Cookbook ID copied"); }
  catch (e) { toast("Couldn't copy — select the text instead"); }
};
Actions.copyCookbookId = async function() {
  try { await navigator.clipboard.writeText(state.session.cookbookId); toast("Cookbook ID copied"); }
  catch (e) { toast("Couldn't copy — select the text instead"); }
};
Actions.submitSession = async function() {
  const username = document.getElementById("w-username").value.trim();
  const cookbookId = document.getElementById("w-cookbook").value.trim().toUpperCase();
  state._wUsername = username;
  state._wCookbook = cookbookId;
  if (!username) { state.modalError = "Enter a username."; renderApp(); return; }
  await openSession({ username, cookbookId });
};
async function openSession(payload) {
  try {
    const data = await API("session", payload);
    state.session = { username: data.username, cookbookId: data.cookbookId };
    saveSession(state.session);
    state.modalError = "";
    state.view = "library";
    await refreshLibrary(true);
    if (data.created) toast("Cookbook created — save your Cookbook ID somewhere safe");
    else if (data.joined) toast("You joined a cookbook shared with " + (data.members - 1) + " other " + (data.members === 2 ? "person" : "people"));
    /* They arrived by scanning something and have only now got a cookbook. */
    const waiting = takeStashedIntent();
    if (waiting) await Actions.beginIntent(waiting);
  } catch (e) {
    if (e.code === "CONFIRM_JOIN") {
      if (confirm(e.message + "\\n\\nJoin this cookbook?")) {
        await openSession(Object.assign({}, payload, { confirmJoin: true }));
        return;
      }
      state.modalError = "";
      renderApp();
      return;
    }
    state.modalError = e.message;
    renderApp();
  }
}
Actions.signOut = function() {
  if (!confirm("Sign out on this device? You will need your username and Cookbook ID to get back in.")) return;
  clearSession();
  state.session = null;
  state.modal = null;
  state.recipes = [];
  state._wUsername = "";
  state._wCookbook = undefined;
  state._suggestedCookbook = null;
  renderApp();
};

/* --- navigation --- */
Actions.openDetail = function(id, showLogs) {
  state.activeId = id; state.view = "detail"; state.scale = 1;
  state.customScaleOpen = false; state._showAllLogs = !!showLogs;
  /* Reached from the box rather than from a calendar square, so the portions
     are the recipe's own again and the banner has nothing to say. */
  state.scheduledFor = null;
  setWatch(id);
  renderApp();
};
Actions.backToLibrary = function() {
  state.view = "library"; state.scheduledFor = null; setWatch(null); renderApp();
};
Actions.openFriends = function() {
  state.view = "friends";
  state.friendsTab = "friends";           /* Friends is the default face of it */
  setWatch(null);
  renderApp();
};
Actions.setFriendsTab = function(which) { state.friendsTab = which; renderApp(); };
Actions.toggleNotificationRead = function(id) {
  const read = loadNotifSet("Read") || {};
  if (read[id]) delete read[id]; else read[id] = 1;
  saveNotifSet("Read", read);
  renderApp();
};
Actions.markAllNotificationsRead = function() {
  const read = loadNotifSet("Read") || {};
  allNotifications().forEach(function (n) { read[n.id] = 1; });
  saveNotifSet("Read", read);
  renderApp();
};
Actions.clearNotifications = function() {
  const list = allNotifications();
  if (!list.length) return;
  if (!confirm("Clear " + list.length + " notification" + (list.length === 1 ? "" : "s") + "? This only affects this device.")) return;
  const cleared = loadNotifSet("Cleared") || {};
  list.forEach(function (n) { cleared[n.id] = 1; });
  saveNotifSet("Cleared", cleared);
  toast("Notifications cleared");
  renderApp();
};
/* Opening the thing marks it read, the way opening a mail does. A cook log
   lands on the recipe with the log already unfolded. */
Actions.openNotification = function(id) {
  const n = allNotifications().filter(function (x) { return x.id === id; })[0];
  if (!n) return;
  const read = loadNotifSet("Read") || {};
  read[id] = 1;
  saveNotifSet("Read", read);
  if (n.kind === "friend") {
    /* There is no one recipe to open, so show the shelf it just unlocked. */
    state.ownerFilter = n.who;
    state.activeTags = [];
    state.search = "";
    state.view = "library";
    renderApp();
    return;
  }
  if (n.kind === "meal" || n.kind === "mealAccept") {
    if (!mealById(n.mealId)) {
      toast("That meal is no longer there");
      renderApp();
      return;
    }
    /* The calendar, with the one tile it was about marked and brought into
       view - the meals list can be long, and an invitation that lands you at
       the top of it has not really taken you anywhere. */
    state.view = "calendar";
    state.mealFocus = n.mealId;
    renderApp();
    scrollToMeal(n.mealId);
    return;
  }
  if (!state.recipes.some(function (r) { return r.recipeId === n.recipeId; })) {
    toast("That recipe is no longer there");
    renderApp();
    return;
  }
  /* A logged cook is the point of the notification, so land with the log
     already unfolded rather than four entries deep. */
  Actions.openDetail(n.recipeId, n.kind === "cook");
};
Actions.refreshWatched = async function() {
  await refreshLibrary(false);
  setWatch(state.activeId);
  renderApp();
};
Actions.loadTheirVersion = function() {
  if (!confirm("Load their version? Your unsaved changes to this recipe will be lost.")) return;
  const id = state.editingId;
  refreshLibrary(false).then(() => {
    setWatch(id);
    if (id && state.recipes.some(x => x.recipeId === id)) Actions.openEdit(id);
    else Actions.backToLibrary();
  });
};
Actions.reload = function() { refreshLibrary(true); };

/* Typing must not re-render the page or the field loses focus mid-word, so
   the clear button is toggled by hand alongside the results. */
Actions.onSearchInput = function(v) {
  state.search = v;
  updateSearchClear();
  updateResultsSection();
};
Actions.clearSearch = function() {
  state.search = "";
  const el = document.getElementById("search-input");
  if (el) { el.value = ""; el.focus(); }
  updateSearchClear();
  updateResultsSection();
};
Actions.saveUsername = async function() {
  const el = document.getElementById("set-name");
  const next = el ? el.value.trim() : "";
  if (!next || next === state.session.username) { toast("That is already your name"); return; }
  try {
    const r = await API("rename", { newUsername: next });
    state.session = { username: r.username, cookbookId: state.session.cookbookId };
    saveSession(state.session);
    toast("Name updated");
    await Actions.reload();
    renderModal();
  } catch (e) { toast(e.message || "Could not change the name"); }
};
Actions.runRetag = async function(apply) {
  const tokenEl = document.getElementById("adm-token");
  const out = document.getElementById("adm-out");
  const token = tokenEl ? tokenEl.value.trim() : "";
  if (!out) return;
  if (!token) { out.textContent = "Enter the admin token first."; return; }
  if (apply && !window.confirm("This rewrites tags on every recipe in every cookbook. Continue?")) return;
  out.textContent = apply ? "Applying..." : "Checking, nothing will be written...";
  try {
    const r = await API("admin/retag", { token: token, apply: apply === true });
    const nl = String.fromCharCode(10);
    const lines = [];
    lines.push(r.applied ? "APPLIED - changes are saved" : "DRY RUN - nothing was written");
    lines.push("Scanned " + r.recipesScanned + " recipes; " + r.recipesChanged +
      (r.applied ? " changed" : " would change"));
    const dropped = Object.keys(r.droppedTags || {});
    lines.push(dropped.length
      ? "Tags with no home (these are lost): " + dropped.map(k => k + " x" + r.droppedTags[k]).join(", ")
      : "Tags with no home: none");
    lines.push("");
    (r.changes || []).forEach(function (c) {
      lines.push(c.title);
      lines.push("   before  " + (c.before.join(", ") || "(none)"));
      lines.push("   after   " + (c.after.join(", ") || "(none)"));
    });
    if (!(r.changes || []).length) lines.push("Nothing to change - already migrated.");
    out.textContent = lines.join(nl);
    if (r.applied) { await Actions.reload(); }
  } catch (e) {
    out.textContent = "Failed: " + (e.message || String(e));
  }
};
/* Clipboard, with the old-browser fallback behind it. Written once because
   the same dance was already spelled out in three places and a fourth would
   have been three too many. The fallback tells you to select the text by
   hand, which only works because every caller shows the text it is copying. */
async function copyToClipboard(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return true; }
  catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy");
      document.body.removeChild(ta); toast(okMsg); return true;
    } catch (e2) { toast("Couldn't copy - select the link and copy it manually"); return false; }
  }
}
Actions.copyAppUrl = async function() {
  await copyToClipboard(appUrl(), "Link copied");
};
/* The same URL the recipe's QR code carries, for when the person you are
   sending it to is not standing next to you. */
Actions.copyRecipeUrl = async function(recipeId) {
  await copyToClipboard(recipeQrUrl(recipeId), "Recipe link copied");
};
Actions.tagTypeahead = function(v) {
  const box = document.getElementById("tag-suggest");
  if (!box) return;
  const q = String(v || "").trim().toLowerCase();
  if (!q) { box.innerHTML = ""; state._suggest = []; return; }
  const have = ((state.editDraft && state.editDraft._tags) || []).map(t => t.toLowerCase());
  const hits = TAG_INDEX.labels
    .filter(l => l.toLowerCase().indexOf(q) >= 0 && have.indexOf(l.toLowerCase()) < 0)
    .sort((a, b) => (a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q)) || a.localeCompare(b))
    .slice(0, 14);
  state._suggest = hits;
  box.innerHTML = hits.length
    ? hits.map((l, i) => '<button class="tag-opt" onclick="Actions.addDraftTag(' + i + ')">' + esc(l) + '</button>').join("")
    : '<span class="helper-text">Nothing in the tag list matches that.</span>';
};
Actions.addDraftTag = function(i) {
  const l = (state._suggest || [])[i];
  if (!l || !state.editDraft) return;
  syncDraftFromDOM();
  state.editDraft._tags = (state.editDraft._tags || []).concat([l]);
  renderApp();
};
Actions.removeDraftTag = function(i) {
  if (!state.editDraft) return;
  syncDraftFromDOM();
  state.editDraft._tags = (state.editDraft._tags || []).filter((x, j) => j !== i);
  renderApp();
};
Actions.openFilters = function() { state.filterSearch = ""; seedFilterPanels(); Actions.openModal("filters"); };
/* Clearing is a reset of the whole menu, not just the chips: every tree
   folds back up so you are looking at the same short list you started with. */
Actions.clearFilters = function() {
  state.activeTags = [];
  state._fopen = {};
  renderApp();
};
Actions.setPanel = function(i, open) {
  const k = (state._panelKeys || [])[i];
  if (k === undefined) return;
  if (open) state._fopen[k] = true; else delete state._fopen[k];
  updateFilterScrollHint();
};
/* Shows or hides the fade at the foot of the list. Called when a tree opens
   or closes, while scrolling, and once the menu is first drawn. The frame
   delay lets layout settle after a <details> toggles, so scrollHeight is the
   new figure rather than the old one. */
function updateFilterScrollHint() {
  const box = document.querySelector(".filter-body");
  if (!box || !box.parentNode || !box.parentNode.classList) return;
  const apply = function () {
    const left = box.scrollHeight - box.clientHeight - box.scrollTop;
    box.parentNode.classList.toggle("more", left > 4);
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(apply);
  else apply();
}
function toggleActiveTag(t) {
  state.activeTags = state.activeTags.some(x => x.toLowerCase() === String(t).toLowerCase())
    ? state.activeTags.filter(x => x.toLowerCase() !== String(t).toLowerCase())
    : state.activeTags.concat([t]);
}
Actions.toggleFilterAt = function(i) {
  const t = (state._filterList || [])[i];
  if (!t) return;
  toggleActiveTag(t);
  /* No rebuild, so nothing to scroll back to - the menu never left. The
     library underneath is left alone until the modal closes; redrawing it
     now only changes the height of a page nobody can see. */
  updateFilterBoxes();
  updateFilterCounts();
};
Actions.toggleTagAt = function(i) {
  const t = (state._tagList || [])[i];
  if (t === undefined) return;
  toggleActiveTag(t);
  updateLibraryChrome();
};
Actions.setOwnerFilter = function(v) {
  state.ownerFilter = v;
  state.activeTags = [];
  /* Called from the results area itself, which updateLibraryChrome replaces
     underneath us, so the label on the picker needs the full pass. */
  renderApp();
};
Actions.pickSearch = function(v) {
  state.pickSearch = v;
  const box = document.querySelector(".pick-list");
  if (box) { renderModal(); const el = document.getElementById("pick-search"); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }
};
Actions.pickOwner = function(i) {
  const v = (state._ownerList || [])[i];
  if (v === undefined) return;
  state.ownerFilter = v;
  state.activeTags = [];
  state.pickSearch = "";
  Actions.closeModal();
  renderApp();
};
Actions.toggleShare = function(i) {
  syncDraftFromDOM();
  const f = state.friends[i];
  if (!f) return;
  const key = f.members[0] || "";
  const d = state.editDraft;
  d._shareWith = d._shareWith || [];
  const at = d._shareWith.indexOf(key);
  if (at >= 0) d._shareWith.splice(at, 1); else d._shareWith.push(key);
  renderApp();
};
Actions.toggleMark = async function(kind, id) {
  const on = !isMarked(kind, id);
  const list = state.marks[kind] || (state.marks[kind] = []);
  if (on) list.push(id); else list.splice(list.indexOf(id), 1);
  renderApp();
  try { await API("recipe/mark", { recipeId: id, kind: kind, on: on }); }
  catch (e) {
    if (on) list.splice(list.indexOf(id), 1); else list.push(id);
    renderApp();
    toast(e.message || "Could not save that");
  }
};
Actions.setSort = function(v) { state.sort = v; updateResultsSection(); };

Actions.setScale = function(p) { state.scale = p; state.customScaleOpen = false; updateRecipeBody(); };
Actions.toggleCustomScale = function() { state.customScaleOpen = !state.customScaleOpen; updateRecipeBody(); };
Actions.setCustomScale = function(v) { const n = parseFloat(v); if (!isNaN(n) && n > 0) state.scale = n; updateRecipeBody(); };
Actions.toggleShowAllLogs = function() { state._showAllLogs = !state._showAllLogs; updateRecipeBody(); };

Actions.openModal = function(name) {
  setTabsDown(false);
  state.modal = name;
  state.modalError = "";
  if (name === "logCook") state.logRating = 0;
  if (name === "import") { state.importParsed = []; state.importErrors = []; state.importFileName = null; state.importVisibility = ""; }
  if (name === "urlToRecipe") state.urlToRecipe = { mode: state._nextImportMode || "url", url: "", text: "", prompt: "", generated: false };
  renderModal();
};
Actions.closeModal = function() { state.modal = null; state.modalError = ""; renderModal(); updateLibraryChrome(); };

/* --- cook log --- */
Actions.setLogRating = function(n) { state.logRating = n; renderModal(); };
Actions.saveCookLog = async function() {
  const r = getActiveRecipe();
  if (!r) return;
  if (!state.logRating) { toast("Pick a rating first"); return; }
  const date = document.getElementById("cl-date").value || todayStr();
  const comment = document.getElementById("cl-notes").value.trim();
  try {
    await API("comment/add", { recipeId: r.recipeId, rating: state.logRating, comment, cookedOn: date });
    state.modal = null;
    await refreshLibrary(false);
    setWatch(r.recipeId);
    toast("Cook logged");
  } catch (e) { state.modalError = e.message; renderModal(); }
};
Actions.deleteComment = async function(commentId) {
  if (!confirm("Delete this cook log entry?")) return;
  try {
    await API("comment/delete", { commentId });
    await refreshLibrary(false);
    toast("Entry deleted");
  } catch (e) { toast(e.message); }
};

/* --- friends --- */
Actions.sendFriendRequest = async function() {
  const el = document.getElementById("friend-name");
  const name = el.value.trim();
  if (!name) { toast("Type their username first"); return; }
  try {
    const res = await API("friend/request", { name });
    el.value = "";
    state.friendPrefill = "";
    await refreshLibrary(false);
    const others = (res.members || []).filter(m => m !== res.username);
    if (res.accepted) {
      toast("You are now linked with " + res.username +
        (others.length ? ". Also added " + others.join(", ") + " because " + res.username + " shares a cookbook with " + others.join(", ") + "." : ""));
    } else {
      toast("Request sent to " + res.username +
        (others.length ? " — " + others.join(", ") + " shares their cookbook, so they will be linked too." : ""));
    }
  } catch (e) { toast(e.message); }
};
/* Held until there is a cookbook to act with, then offered as a question. */
/* A recipe link now does one thing: it opens the recipe. It asks nobody to
   be friends and pins nothing on its own. It works without a session, so
   somebody who has never heard of the app can read what they were sent, and
   the offer of an account is a back button rather than a wall. */
Actions.beginIntent = async function(intent) {
  if (!intent) return;
  if (intent.type === "recipe") {
    /* Kept in storage either way: if they do go and make a cookbook, they
       come back to the recipe they were sent rather than to an empty box. */
    if (!state.session) stashIntent(intent);
    try {
      const p = await API("recipe/public", { recipeId: intent.recipeId });
      state.linkRecipe = {
        recipeId: p.recipeId, owner: p.owner, household: p.household,
        visibility: p.visibility, body: normalizeBody(p.data || {})
      };
      state.linkError = "";
    } catch (e) {
      state.linkRecipe = null;
      state.linkError = e.message || "That link could not be opened.";
    }
    state.view = "link";
    state.scale = 1;
    renderApp();
    return;
  }
  if (!state.session) { stashIntent(intent); return; }
  state.intent = intent;
  state.modalError = "";
  Actions.openModal("confirmIntent");
};
Actions.dismissIntent = function() {
  state.intent = null;
  Actions.closeModal();
};
/* Only the friend code reaches this now; a recipe link opens the recipe
   directly and never raises the confirm sheet. */
Actions.runIntent = async function() {
  const c = state.intent;
  if (!c || state.busy) return;
  state.busy = true;
  renderModal();
  try {
    const res = await API("friend/request", { name: c.name });
    state.intent = null;
    state.modal = null;
    await refreshLibrary(false);
    toast(res.accepted
      ? "You are now linked with " + res.username
      : "Request sent to " + res.username + " — you will see their shared recipes once they accept");
  } catch (e) {
    state.modalError = e.message;
    renderModal();
  } finally {
    state.busy = false;
    if (state.modal) renderModal();
  }
};

Actions.respondFriend = async function(name, action) {
  try {
    const res = await API("friend/respond", { name, action });
    await refreshLibrary(false);
    const others = (res.members || []).filter(m => m !== name);
    if (action === "accept") {
      toast("You are now linked with " + name +
        (others.length ? ". Also added " + others.join(", ") + " because " + name + " shares a cookbook with " + others.join(", ") + "." : ""));
    } else {
      toast("Declined " + name);
    }
  } catch (e) { toast(e.message); }
};
Actions.removeFriend = async function(name) {
  const linked = state.friends.reduce((a, f) => a.concat(f.members), [])
    .concat(state.outgoing.reduce((a, f) => a.concat(f.members), []));
  const alsoNames = linked.filter(n => n !== name);
  const warn = "Remove " + name + "? You will stop seeing each other's recipes." +
    (alsoNames.length ? " Anyone who shares their cookbook goes too." : "");
  if (!confirm(warn)) return;
  try {
    const res = await API("friend/remove", { name });
    await refreshLibrary(false);
    const removed = (res.members || [name]);
    toast("Removed " + removed.join(", "));
  } catch (e) { toast(e.message); }
};
Actions.allowFriend = async function(name) {
  try {
    await API("friend/allow", { name });
    await refreshLibrary(false);
    toast(name + " can send you a request again");
  } catch (e) { toast(e.message); }
};

/* --- import / export --- */
Actions.setImportVisibility = function(v) { state.importVisibility = v; renderModal(); };
Actions.handleImportFile = function(input) {
  const file = input.files[0];
  if (!file) return;
  state.importFileName = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const out = parseRecipeFile(ev.target.result);
    state.importParsed = out.parsed;
    state.importErrors = out.errorLines;
    renderModal();
  };
  reader.readAsText(file);
};
Actions.pasteImportFile = async function() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) { toast("Clipboard is empty"); return; }
    const out = parseRecipeFile(text);
    state.importParsed = out.parsed;
    state.importErrors = out.errorLines;
    state.importFileName = "Pasted from clipboard";
    renderModal();
  } catch (e) {
    toast("Couldn't read the clipboard — use “Choose a file” instead");
  }
};
Actions.confirmImport = async function() {
  if (!state.importParsed.length) return;
  if (!state.importVisibility) { toast("Choose private or shared first"); return; }
  try {
    const res = await API("recipe/import", { recipes: state.importParsed, visibility: state.importVisibility });
    state.modal = null;
    state.view = "library";
    await refreshLibrary(false);
    toast("Imported " + res.count + " recipe" + (res.count === 1 ? "" : "s"));
  } catch (e) { state.modalError = e.message; renderModal(); }
};
Actions.exportAll = function() {
  const list = hasActiveFilter() ? filteredRecipes() : state.recipes;
  if (!list.length) { toast("Nothing to export"); return; }
  const lines = list.map(r => JSON.stringify(normalizeBody(r)));
  const blob = new Blob([lines.join("\\n")], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (hasActiveFilter() ? "recipe-box-selected-" : "recipe-box-export-") + todayStr() + ".txt";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/* --- URL to recipe --- */
Actions.openImportPrompt = function(mode) {
  state._nextImportMode = mode;
  Actions.openModal("urlToRecipe");
  state._nextImportMode = null;
};
Actions.generatePrompt = function() {
  const u = state.urlToRecipe;
  let payload = "";
  if (u.mode === "url") {
    const el = document.getElementById("utr-url");
    const url = el ? el.value.trim() : "";
    if (!url) { toast("Paste a URL first"); return; }
    u.url = url;
    payload = url;
  } else if (u.mode === "text") {
    const el2 = document.getElementById("utr-text");
    const body = el2 ? el2.value.trim() : "";
    if (!body) { toast("Paste the recipe text first"); return; }
    u.text = body;
    payload = body;
  }
  u.prompt = buildImportPrompt(u.mode, payload);
  u.generated = true;
  renderModal();
};
Actions.copyPrompt = async function() {
  const ta = document.getElementById("utr-prompt");
  try { await navigator.clipboard.writeText(ta.value); toast("Prompt copied"); }
  catch (e) {
    try {
      ta.removeAttribute("readonly"); ta.select(); document.execCommand("copy");
      ta.setAttribute("readonly", "true"); toast("Prompt copied");
    } catch (e2) { toast("Couldn't copy — select the text manually"); }
  }
};
Actions.loadPastedResponse = function() {
  const text = document.getElementById("utr-response").value.trim();
  if (!text) { toast("Paste the answer first"); return; }
  const out = parseRecipeFile(text);
  if (!out.parsed.length) {
    state.modalError = "That didn't read as a recipe. Most often it is the keyboard's “smart quotes” — turn off Settings → Keyboard → Smart Punctuation and paste again, or check the whole answer was copied.";
    renderModal();
    return;
  }
  const draft = out.parsed[0].body;
  draft.visibility = "";
  draft._tags = canonicalTags(draft.tags);
  draft._shareWith = [];
  if (!draft.ingredients.length) draft.ingredients = [normalizeBody({ ingredients: [{}] }).ingredients[0]];
  if (!draft.steps.length) draft.steps = [normalizeBody({ steps: [{}] }).steps[0]];
  state.editDraft = draft;
  state.editIsNew = true;
  state.editingId = null;
  state.editBaseUpdatedAt = null;
  state.editForce = false;
  setWatch(null);
  state.view = "edit";
  state.modal = null;
  renderApp();
  toast("Check it over, pick private or shared, then save");
};

/* --- editing --- */
Actions.openNew = function() {
  state.editDraft = blankDraft();
  state.editIsNew = true;
  state.editingId = null;
  state.editBaseUpdatedAt = null;
  state.editForce = false;
  setWatch(null);
  state.view = "edit";
  renderApp();
};
Actions.openEdit = async function(id, takeover) {
  const r = state.recipes.find(x => x.recipeId === id);
  if (!r || !r.ours) { toast("You can only edit recipes in your own cookbook"); return; }

  /* Claim the recipe before opening the form, so two people cannot both
     spend ten minutes on the same edit. */
  try {
    await API("recipe/lock", { recipeId: id, takeover: !!takeover });
  } catch (e) {
    if (e.code === "LOCKED") {
      state.lockedInfo = {
        recipeId: id,
        who: (e.detail && e.detail.lockedBy) || "Someone",
        since: (e.detail && e.detail.lockedAt) || "",
        freeIn: (e.detail && e.detail.expiresInSeconds) || 0
      };
      state.modal = "locked";
      renderModal();
      return;
    }
    toast(e.message);
    return;
  }
  state.lockHeld = id;
  const d = normalizeBody(r);
  d.visibility = r.visibility;
  /* shares come back as household labels; the draft tracks one member each */
  d._shareWith = (state.shares[r.recipeId] || []).map(function (label) {
    const f = state.friends.filter(x => x.label === label)[0];
    return f ? (f.members[0] || "") : "";
  }).filter(Boolean);
  d._tags = canonicalTags(r.tags);
  if (!d.ingredients.length) d.ingredients = [{ name: "", metricValue: "", metricUnit: "g", customaryValue: "", customaryUnit: "cup", notes: "" }];
  if (!d.steps.length) d.steps = [{ text: "", timerMinutes: "" }];
  state.editDraft = d;
  state.editIsNew = false;
  state.editingId = id;
  state.editBaseUpdatedAt = r.updatedAt;
  state.editForce = false;
  state.view = "edit";
  setWatch(id);
  renderApp();
};
async function releaseLock() {
  const id = state.lockHeld;
  state.lockHeld = null;
  if (!id) return;
  try { await API("recipe/unlock", { recipeId: id }); } catch (e) {}
}

Actions.cancelEdit = function() {
  releaseLock();
  state.view = state.editingId ? "detail" : "library";
  renderApp();
};
Actions.takeOverLock = function() {
  const info = state.lockedInfo;
  state.modal = null;
  state.lockedInfo = null;
  renderModal();
  if (info) Actions.openEdit(info.recipeId, true);
};
Actions.dismissLock = function() {
  state.modal = null;
  state.lockedInfo = null;
  renderModal();
};
Actions.setDraftVisibility = function(v) {
  syncDraftFromDOM();
  state.editDraft.visibility = v;
  renderApp();
};
Actions.addIngredient = function() {
  syncDraftFromDOM();
  state.editDraft.ingredients.push({ name: "", metricValue: "", metricUnit: "g", customaryValue: "", customaryUnit: "cup", notes: "" });
  renderApp();
};
Actions.removeIngredient = function(idx) {
  syncDraftFromDOM();
  state.editDraft.ingredients.splice(idx, 1);
  renderApp();
};
Actions.moveIngredient = function(idx, dir) {
  syncDraftFromDOM();
  const list = state.editDraft.ingredients;
  const j = idx + dir;
  if (j < 0 || j >= list.length) return;
  const tmp = list[idx]; list[idx] = list[j]; list[j] = tmp;
  renderApp();
};
Actions.addStep = function() {
  syncDraftFromDOM();
  state.editDraft.steps.push({ text: "", timerMinutes: "" });
  renderApp();
};
Actions.removeStep = function(idx) {
  syncDraftFromDOM();
  state.editDraft.steps.splice(idx, 1);
  renderApp();
};
Actions.moveStep = function(idx, dir) {
  syncDraftFromDOM();
  const list = state.editDraft.steps;
  const j = idx + dir;
  if (j < 0 || j >= list.length) return;
  const tmp = list[idx]; list[idx] = list[j]; list[j] = tmp;
  renderApp();
};
Actions.saveRecipeForm = async function() {
  syncDraftFromDOM();
  const d = state.editDraft;
  if (!d.title || !d.title.trim()) { toast("Give the recipe a title first"); return; }
  if (!d.visibility) { toast("Choose who can see this first"); return; }
  if (state.busy) return;
  state.busy = true;
  const body = normalizeBody(Object.assign({}, d, {
    tags: canonicalTags(d._tags || [])
  }));
  try {
    const res = await API("recipe/save", {
      recipeId: state.editingId || null,
      data: body,
      visibility: d.visibility,
      baseUpdatedAt: state.editBaseUpdatedAt,
      force: state.editForce
    });
    if (d.visibility === "selective") {
      await API("recipe/share", { recipeId: res.recipeId, usernames: d._shareWith || [] });
    }
    state.activeId = res.recipeId;
    state.editingId = null;
    state.editBaseUpdatedAt = null;
    state.editForce = false;
    state.lockHeld = null;
    state.view = "detail";
    state.scale = 1;
    await refreshLibrary(false);
    setWatch(res.recipeId);
    toast("Recipe saved");
  } catch (e) {
    if (e.code === "CONFLICT") {
      state.conflict = {
        who: (e.detail && e.detail.updatedBy) || "Someone",
        when: (e.detail && e.detail.updatedAt) || ""
      };
      state.modal = "conflict";
      renderModal();
      return;
    }
    toast(e.message);
    renderApp();
  } finally { state.busy = false; }
};

Actions.resolveConflict = async function(choice) {
  const c = state.conflict;
  state.conflict = null;
  state.modal = null;
  if (choice === "mine") {
    state.editForce = true;
    renderModal();
    await Actions.saveRecipeForm();
    return;
  }
  if (choice === "theirs") {
    const id = state.editingId;
    await refreshLibrary(false);
    if (id && state.recipes.some(x => x.recipeId === id)) Actions.openEdit(id);
    else Actions.backToLibrary();
    toast("Loaded " + (c ? c.who : "their") + "'s version");
    return;
  }
  renderModal();
};
Actions.deleteRecipe = async function() {
  const id = state.editingId;
  if (!id) return;
  if (!confirm("Delete this recipe for good? Its cook log goes with it.")) return;
  try {
    await API("recipe/delete", { recipeId: id });
    state.lockHeld = null;
    state.activeId = null;
    state.editingId = null;
    state.view = "library";
    await refreshLibrary(false);
    toast("Recipe deleted");
  } catch (e) { toast(e.message); }
};
/* state.shares holds household labels; recipe/share wants one member name per
   cookbook, the same translation openEdit makes. */
function shareKeysFor(recipeId) {
  return (state.shares[recipeId] || []).map(function (label) {
    const f = state.friends.filter(x => x.label === label)[0];
    return f ? (f.members[0] || "") : "";
  }).filter(Boolean);
}
Actions.setVisibility = async function(next) {
  const r = getActiveRecipe();
  if (!r || !r.ours) return;
  if (["private", "selective", "friends"].indexOf(next) < 0) return;
  try {
    await API("recipe/visibility", { recipeId: r.recipeId, visibility: next });
    /* Selective without anybody ticked reaches nobody, so the sheet stays
       open on the list of friends rather than closing on a recipe that is
       shared with no one. */
    if (next === "selective") {
      await refreshLibrary(false);
      state.visDraft = shareKeysFor(r.recipeId);
      setWatch(r.recipeId);
      renderApp();
      return;
    }
    Actions.closeModal();
    await refreshLibrary(false);
    setWatch(r.recipeId);
    toast(next === "friends" ? "Shared with all your friends" : "Now " + privateLabel().toLowerCase());
  } catch (e) { toast(e.message); }
};
/* Ticking a friend on an already-saved recipe writes straight through - there
   is no Save button on this sheet, so the tick is the commitment. */
Actions.toggleVisShare = async function(i) {
  const r = getActiveRecipe();
  const f = state.friends[i];
  if (!r || !r.ours || !f) return;
  const key = f.members[0] || "";
  const list = (state.visDraft || []).slice();
  const at = list.indexOf(key);
  if (at >= 0) list.splice(at, 1); else list.push(key);
  state.visDraft = list;
  renderModal();
  try {
    await API("recipe/share", { recipeId: r.recipeId, usernames: list });
    await refreshLibrary(false);
  } catch (e) { toast(e.message); }
};
/* Leaving a shared recipe. With an account that means the recipe box; with
   none it means the sign-in screen, which is what the back button offers to
   somebody reading a link cold. The stashed intent survives either way, so
   making a cookbook lands them back on the recipe they came for. */
/* Clears whatever the render choked on and goes back to the front door. */
Actions.recoverFromError = function() {
  state.linkRecipe = null; state.linkError = ""; state.modal = null;
  state.view = state.session ? "library" : "welcome";
  try { renderApp(); } catch (e) { location.href = "/"; }
};
Actions.leaveLinkView = function() {
  state.linkRecipe = null;
  state.linkError = "";
  state.view = state.session ? "library" : "welcome";
  renderApp();
};
/* Taking a link recipe into the library so something can be done to it.
   Every one of the four buttons comes through here first, because the recipe
   is not in state.recipes yet and half the app resolves recipes by looking
   there. Claiming and then refreshing turns it into an ordinary library
   recipe, after which the existing toggle and schedule paths work on it with
   no special cases of their own.
   The mark asked for is the mark left behind - Favorite favourites, and does
   not quietly pin as well. A null asks for the grant alone. */
async function claimFromLink(mark) {
  const lr = state.linkRecipe;
  if (!lr || !state.session || state.busy) return null;
  state.busy = true;
  renderApp();
  try {
    const res = await API("recipe/claim", { recipeId: lr.recipeId, mark: mark });
    await refreshLibrary(false);
    state.busy = false;
    return res;
  } catch (e) {
    state.busy = false;
    toast(e.message);
    renderApp();
    return null;
  }
}
/* Pin still ends on the recipe in your own box - it is the one mark that
   means "this is mine now", and landing on it is the confirmation. Favorite
   and Save for later stay put and just light up, because they are things you
   note in passing rather than places you go. */
Actions.markFromLink = async function(kind) {
  const lr = state.linkRecipe;
  if (!lr || !state.session || state.busy) return;
  /* Already in the library - your own recipe, one a friend shares, or one
     claimed a moment ago - so there is nothing to claim and this is just the
     ordinary toggle. Sending it through claim instead would return early on
     a recipe of your own and quietly drop the mark. */
  if (recipeById(lr.recipeId) || isMarked(kind, lr.recipeId)) {
    await Actions.toggleMark(kind, lr.recipeId);
    renderApp();
    return;
  }
  const res = await claimFromLink(kind);
  if (!res) return;
  const landed = res.recipeId && state.recipes.some(function (r) { return r.recipeId === res.recipeId; });
  if (kind === "pin" && landed) {
    state.linkRecipe = null;
    state._showAllLogs = false;
    Actions.openDetail(res.recipeId);
    toast(res.mine ? "Opened" : "Pinned to your cookbook");
    return;
  }
  if (res.mine && landed) {
    state.linkRecipe = null;
    state._showAllLogs = false;
    Actions.openDetail(res.recipeId);
    return;
  }
  renderApp();
  toast(kind === "star" ? "Added to your favorites" : "Saved for later");
};
/* Scheduling takes the grant and no mark: a dinner on Tuesday is not a
   favourite. Once the refresh has landed it, the ordinary schedule frame can
   take over, ingredients and portions and all. */
Actions.scheduleFromLink = async function() {
  const lr = state.linkRecipe;
  if (!lr || !state.session || state.busy) return;
  const id = lr.recipeId;
  if (recipeById(id)) { Actions.openSchedule(id); return; }
  const res = await claimFromLink(null);
  if (!res) return;
  if (!recipeById(id)) { renderApp(); toast("That recipe could not be added to your box."); return; }
  renderApp();
  Actions.openSchedule(id);
};
/* Tapping who a recipe came from. Lands on the friends page with their name
   already in the box, so the whole gesture is tap-the-name then tap Add. */
Actions.askToBeFriends = function(name) {
  if (!state.session) return;
  state.linkRecipe = null;
  state.friendPrefill = String(name || "");
  state.view = "friends";
  state.friendsTab = "friends";
  renderApp();
  const el = document.getElementById("friend-name");
  if (el) { el.value = state.friendPrefill; el.focus(); }
};

Actions.mergeRecipe = async function(id) {
  const r = state.recipes.find(x => x.recipeId === id);
  if (!r) return;
  if (!confirm("Copy " + r.title + " into your cookbook? You will get your own editable copy, starting private and with an empty cook log.")) return;
  try {
    const res = await API("recipe/merge", { recipeId: id });
    await refreshLibrary(false);
    state.activeId = res.recipeId;
    state.view = "detail";
    renderApp();
    toast("Copied into your cookbook");
  } catch (e) { toast(e.message); }
};

/* --- tabs --- */
/* A tab always lands on the top of its section. Coming back to Recipes from a
   recipe means the box, not the recipe you were already looking at, and the
   watch on that recipe is dropped on the way out. */
Actions.goTab = function(tab) {
  setTabsDown(false);
  flushGrocerySave();
  setWatch(null);
  state.calDay = null;
  state.groceryMergeFrom = null;
  if (tab === "calendar") { state.view = "calendar"; state._calTop = null; }
  else if (tab === "groceries") {
    state.view = "groceries";
    state.activeListId = null;
    /* Opening the tab with today in both boxes means the common case - a shop
       for tonight - is already filled in. */
    if (!state.groceryRange.start && !state.groceryRange.end) {
      const t = localToday();
      state.groceryRange = { start: t, end: t };
    }
  }
  else { state.view = "library"; state.scheduledFor = null; }
  renderApp();
};

/* --- calendar --- */
Actions.onSchedScroll = function(el) { if (el) state.schedWeekTop = el.scrollTop; };

Actions.calToday = function() {
  state._calTop = Math.max(0, (state.calBack - 1) * CAL_ROW);
  placeCalendarScroll();
};
/* Scrolling to either edge adds six more weeks that way. Repainting just the
   grid rather than the view keeps the gesture from being interrupted, and the
   scroll position is nudged by the height of what was added above so the week
   under the finger stays under the finger. */
const CAL_MAX_WEEKS = 260;
Actions.onCalScroll = function(el) {
  if (!el) return;
  state._calTop = el.scrollTop;
  const room = el.scrollHeight - el.clientHeight;
  if (el.scrollTop < CAL_ROW && state.calBack < CAL_MAX_WEEKS) {
    state.calBack += 6;
    repaintCalendarGrid(el, 6 * CAL_ROW);
  } else if (room - el.scrollTop < CAL_ROW && state.calFwd < CAL_MAX_WEEKS) {
    state.calFwd += 6;
    repaintCalendarGrid(el, 0);
  }
};
function repaintCalendarGrid(el, shift) {
  const grid = el.querySelector(".cal-grid");
  if (!grid) return;
  const today = localToday();
  let cells = "";
  /* Worked out once for the whole grid rather than per square: it is a walk
     over every dish on every meal, and there are a few hundred squares. */
  const mealEntries = mealEntryIds();
  calWeekStarts().forEach(function (ws) {
    for (let i = 0; i < 7; i++) cells += CalCellHTML(addDays(ws, i), today, mealEntries);
  });
  const at = el.scrollTop;
  grid.innerHTML = cells;
  el.scrollTop = at + shift;
  state._calTop = el.scrollTop;
}
Actions.openCalDay = function(key) {
  state.calDay = key;
  /* A query typed while looking at Monday has nothing to say about Tuesday. */
  state.daySearch = "";
  state.modal = "calDay";
  state.modalError = "";
  renderApp();
};
/* A chip goes to the recipe with the portions it was scheduled at already
   applied, and says so at the top so the numbers are not a mystery. */
Actions.openScheduled = function(entryId) {
  const e = entryById(entryId);
  if (!e) return;
  const r = recipeById(e.recipeId);
  if (!r) { toast("That recipe is no longer in your box"); return; }
  state.modal = null;
  state.calDay = null;
  state.activeId = e.recipeId;
  state.view = "detail";
  state.scale = factorFor(r, e.servings);
  state.customScaleOpen = SCALE_PRESETS.indexOf(state.scale) < 0;
  state.scheduledFor = { entryId: e.entryId, recipeId: e.recipeId, date: e.date, servings: e.servings };
  state._showAllLogs = false;
  setWatch(e.recipeId);
  renderApp();
};

/* Same rule as the library search: repaint the results only, or the field
   loses focus and the word is lost halfway through typing it. */
/* Results render below the fold on a phone, so tapping the field brings the
   search block up to the top of the dialog. Aligning the block rather than
   scrolling to the very bottom means the results stay in view as they grow,
   instead of pushing themselves back off the end. Repeated because iOS
   raises the keyboard and re-lays out the viewport after the focus event,
   which undoes a single scroll set before it. */
function pinBlockIntoView(blockId) {
  const pin = function () {
    const box = document.querySelector(".modal-box");
    const blk = document.getElementById(blockId);
    if (!box || !blk || !box.getBoundingClientRect) return;
    const b = box.getBoundingClientRect(), t = blk.getBoundingClientRect();
    box.scrollTop = box.scrollTop + (t.top - b.top) - 8;
  };
  pin();
  setTimeout(pin, 200);
  setTimeout(pin, 500);
}
/* A dialog rebuilt in place starts back at the top, which throws away
   whatever the person had scrolled to. Changing the servings and being
   returned to the top of the frame - away from the ingredient list you
   changed it to look at - is the whole complaint. */
function renderModalKeepingScroll() {
  const before = document.querySelector(".modal-box");
  const at = before ? before.scrollTop : 0;
  renderModal();
  const after = document.querySelector(".modal-box");
  if (after) after.scrollTop = at;
}
Actions.onDaySearchFocus = function() { pinBlockIntoView("day-search-block"); };
/* Same treatment for the day and servings row. Pinning that row to the top
   puts the ingredient list directly beneath it, so the numbers can be watched
   changing rather than hunted for after the keyboard has covered them. */
Actions.onSchedFieldFocus = function() { pinBlockIntoView("sched-fields"); };
Actions.onDaySearchInput = function(v) {
  state.daySearch = v;
  const box = document.getElementById("day-results");
  if (box) box.innerHTML = DayResultsHTML();
};
/* Picked from the day sheet, so the day is already answered. Coming back here
   afterwards is the point - a Tuesday usually needs more than one thing. */
Actions.scheduleFromDay = function(recipeId) {
  Actions.openSchedule(recipeId, state.calDay, true);
};

Actions.openSchedule = function(recipeId, onDate, backToDay) {
  const r = recipeById(recipeId);
  if (!r) { toast("That recipe is no longer in your box"); return; }
  state.scheduleDraft = {
    entryId: null,
    recipeId: recipeId,
    date: onDate || state.calDay || localToday(),
    servings: (Number(r.servings.base) > 0 ? Number(r.servings.base) : 1),
    backToDay: !!backToDay
  };
  state.schedWeekTop = null;
  state.modal = "schedule";
  state.modalError = "";
  renderApp();
};
/* The same frame doing the other half of its job. Because it carries a week
   strip and a servings box, editing an entry covers both "make more of it"
   and "actually, Thursday" without a second dialog for the second case. */
Actions.openScheduleEdit = function(entryId) {
  const e = entryById(entryId);
  if (!e) return;
  const r = recipeById(e.recipeId);
  if (!r) { toast("That recipe is no longer in your box"); return; }
  state.scheduleDraft = {
    entryId: e.entryId,
    recipeId: e.recipeId,
    date: e.date,
    servings: e.servings,
    backToDay: !!state.calDay
  };
  state.schedWeekTop = null;
  state.modal = "schedule";
  state.modalError = "";
  renderApp();
};
Actions.setScheduleField = function(field, value) {
  if (!state.scheduleDraft) return;
  if (field === "servings") {
    const n = parseFloat(value);
    state.scheduleDraft.servings = (isNaN(n) || n <= 0) ? state.scheduleDraft.servings : n;
  } else {
    state.scheduleDraft.date = String(value || "").slice(0, 10) || state.scheduleDraft.date;
  }
  if (field === "servings") {
    const strip = document.getElementById("sched-strip");
    if (strip) state.schedWeekTop = strip.scrollTop;
    /* Only the ingredient numbers below have changed, so stay put. */
    renderModalKeepingScroll();
  } else {
    /* A new day re-anchors the strip on that day's week. */
    state.schedWeekTop = null;
    renderModal();
  }
  placeSchedStrip();
};
Actions.addToCalendar = async function() {
  const d = state.scheduleDraft;
  if (!d) return;
  const r = recipeById(d.recipeId);
  if (!r) { state.modalError = "That recipe is no longer in your box."; renderModal(); return; }
  const dateEl = document.getElementById("sched-date");
  const servEl = document.getElementById("sched-servings");
  const date = (dateEl && dateEl.value) ? String(dateEl.value).slice(0, 10) : d.date;
  const servRaw = servEl ? parseFloat(servEl.value) : d.servings;
  const servings = (isNaN(servRaw) || servRaw <= 0) ? d.servings : servRaw;
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) { state.modalError = "Pick a day."; renderModal(); return; }
  const backToDay = !!d.backToDay;
  state.busy = true;
  try {
    if (d.entryId) {
      await API("schedule/update", { entryId: d.entryId, date: date, servings: servings });
      state.schedule = state.schedule.map(function (e) {
        return e.entryId === d.entryId ? Object.assign({}, e, { date: date, servings: servings }) : e;
      });
      /* The banner on an open recipe is looking at this same entry. */
      if (state.scheduledFor && state.scheduledFor.entryId === d.entryId) {
        state.scheduledFor = Object.assign({}, state.scheduledFor, { date: date, servings: servings });
        state.scale = factorFor(r, servings);
        state.customScaleOpen = SCALE_PRESETS.indexOf(state.scale) < 0;
      }
      toast(r.title + " moved to " + shortDate(date));
    } else {
      const res = await API("schedule/add", {
        recipeId: d.recipeId, date: date, servings: servings, title: r.title
      });
      state.schedule.push(res.entry);
      toast(r.title + " scheduled for " + shortDate(date));
    }
    state.scheduleDraft = null;
    state.modalError = "";
    /* Straight back to the day sheet when that is where this started, so a
       Tuesday needing three things does not mean opening it three times. */
    if (backToDay) {
      state.calDay = date;
      state.daySearch = "";
      state.modal = "calDay";
    } else {
      state.modal = null;
    }
  } catch (e) {
    state.modalError = e.message;
  } finally {
    state.busy = false;
    renderApp();
  }
};
/* ---- community meals --------------------------------------------------
   Every one of these re-reads the library afterwards rather than patching
   state by hand. A meal is shared between cookbooks, so our copy of it is
   only ever a snapshot: the moment we change anything, the authoritative
   version is the server's. Patching locally would be guessing at what four
   other people did in the meantime. */
Actions.openNewMeal = function() {
  if (!state.friends.length) {
    toast("Add a friend first — a community meal is cooked between cookbooks");
    return;
  }
  state.mealDraft = {
    mealId: null, title: "", description: "", location: "",
    date: localToday(), time: "18:00",
    guests: [], dishes: [], search: "", pick: null
  };
  state.mealFriendSearch = "";
  state.modalError = "";
  Actions.openModal("meal");
};
Actions.openEditMeal = function(mealId) {
  const m = mealById(mealId);
  if (!m) return;
  state.mealDraft = {
    mealId: mealId, title: m.title,
    description: m.description || "", location: m.location || "",
    date: m.date, time: m.time || "",
    guests: [], dishes: [], search: "", pick: null
  };
  state.mealFriendSearch = "";
  state.modalError = "";
  Actions.openModal("meal");
};
/* Typing in the guest search redraws the sheet, which replaces the field
   underneath the cursor, so the caret is put back where it was. Same shape
   as the Whose recipes picker this was lifted from. */
Actions.mealFriendSearch = function(v) {
  state.mealFriendSearch = v;
  readMealDraftFields();
  renderModal();
  const el = document.getElementById("meal-friend-search");
  if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
};
Actions.toggleMealGuest = function(username) {
  const dr = state.mealDraft;
  if (!dr) return;
  /* The form is re-read before the list is redrawn, or typing a title and
     then picking a guest would lose the title. */
  readMealDraftFields();
  const at = dr.guests.map(u => u.toLowerCase()).indexOf(String(username).toLowerCase());
  if (at >= 0) dr.guests.splice(at, 1); else dr.guests.push(username);
  renderModal();
};
function readMealDraftFields() {
  const dr = state.mealDraft;
  if (!dr) return;
  const t = document.getElementById("meal-title");
  const d = document.getElementById("meal-date");
  const h = document.getElementById("meal-time");
  const ds = document.getElementById("meal-desc");
  const lo = document.getElementById("meal-loc");
  if (t) dr.title = t.value;
  if (d) dr.date = d.value;
  if (h) dr.time = h.value;
  if (ds) dr.description = ds.value;
  if (lo) dr.location = lo.value;
}
Actions.saveMeal = async function() {
  const dr = state.mealDraft;
  if (!dr) return;
  readMealDraftFields();
  const title = String(dr.title || "").trim();
  if (!title) { state.modalError = "Give the meal a name."; renderModal(); return; }
  if (!dr.date) { state.modalError = "Pick a day."; renderModal(); return; }
  try {
    if (dr.mealId) {
      await API("meal/update", {
        mealId: dr.mealId, title, date: dr.date, time: dr.time || "",
        description: dr.description || "", location: dr.location || ""
      });
    } else {
      const made = await API("meal/create", {
        title, date: dr.date, time: dr.time || "", guests: dr.guests,
        description: dr.description || "", location: dr.location || ""
      });
      /* The dishes were staged against a meal that did not exist yet, so
         they are committed one at a time now that it does. A dish that fails
         is reported and the rest still go: the meal itself is already made,
         and losing all of them over one missing recipe would be worse. */
      const missed = [];
      for (const d of dr.dishes) {
        try {
          await API("meal/dish/add", {
            mealId: made.mealId, recipeId: d.recipeId, servings: d.servings
          });
        } catch (e) { missed.push(d.title); }
      }
      if (missed.length) toast("Could not add " + missed.join(", "));
    }
    state.modal = null;
    state.modalError = "";
    state.mealDraft = null;
    await refreshLibrary(false);
    toast(dr.mealId ? "Meal updated" : "Meal created");
  } catch (err) {
    state.modalError = err.message;
    renderModal();
    return;
  }
  renderApp();
};
Actions.openMealGuests = function(mealId) {
  const m = mealById(mealId);
  if (!m) return;
  state.mealDraft = { mealId: mealId, guests: [], dishes: [], search: "", pick: null };
  state.mealFriendSearch = "";
  state.modalError = "";
  Actions.openModal("mealGuests");
};
Actions.sendMealInvites = async function() {
  const dr = state.mealDraft;
  if (!dr || !dr.mealId) return;
  if (!dr.guests.length) { state.modalError = "Pick somebody to invite."; renderModal(); return; }
  try {
    await API("meal/invite", { mealId: dr.mealId, guests: dr.guests });
    state.modal = null;
    state.modalError = "";
    state.mealDraft = null;
    await refreshLibrary(false);
    toast("Invitations sent");
  } catch (err) {
    state.modalError = err.message;
    renderModal();
    return;
  }
  renderApp();
};
Actions.uninviteGuest = async function(mealId, label) {
  const m = mealById(mealId);
  if (!m) return;
  /* The tile shows household labels; the API wants a username. Any member of
     that cookbook identifies it, so the friend list is walked to find one. */
  const f = state.friends.filter(x => x.label === label)[0];
  const who = f ? (f.members[0] || "") : "";
  if (!who) { toast("Cannot un-invite them from here"); return; }
  if (!confirm("Take back " + label + "'s invitation to " + m.title + "?")) return;
  try {
    await API("meal/uninvite", { mealId, guest: who });
    await refreshLibrary(false);
    toast("Invitation withdrawn");
  } catch (err) { toast(err.message); }
  renderApp();
};
Actions.respondMeal = async function(mealId, answer) {
  const m = mealById(mealId);
  if (!m) return;
  if (answer === "decline" && !confirm("Decline " + m.title + "? It will come off your calendar.")) return;
  try {
    await API("meal/respond", { mealId, answer });
    await refreshLibrary(false);
    toast(answer === "accept" ? "You are going" : "Declined");
  } catch (err) { toast(err.message); }
  renderApp();
};
Actions.leaveMeal = async function(mealId) {
  const m = mealById(mealId);
  if (!m) return;
  if (!confirm("Take yourself off " + m.title + "? Anything you signed up to bring comes off " +
    "your calendar too.")) return;
  try {
    await API("meal/leave", { mealId });
    await refreshLibrary(false);
    toast("Taken off the meal");
  } catch (err) { toast(err.message); }
  renderApp();
};
Actions.cancelMeal = async function(mealId) {
  const m = mealById(mealId);
  if (!m) return;
  if (!confirm("Cancel " + m.title + " for everyone? Every guest's dishes come off their " +
    "calendars as well as yours. This cannot be undone.")) return;
  try {
    await API("meal/cancel", { mealId });
    await refreshLibrary(false);
    toast("Meal cancelled");
  } catch (err) { toast(err.message); }
  renderApp();
};
/* Bring a tile into view and let the ring fade once it has been seen. The
   highlight is a pointer, not a state - leaving it on would mean every later
   visit to the calendar still had one tile shouting. */
function scrollToMeal(mealId) {
  setTimeout(function () {
    const el = document.getElementById("meal-" + mealId);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(function () {
      if (state.mealFocus !== mealId) return;
      state.mealFocus = null;
      const still = document.getElementById("meal-" + mealId);
      if (still && still.classList) still.classList.remove("meal-focus");
    }, 2600);
  }, 60);
}
Actions.toggleMealPast = function(mealId) {
  state.mealPastOpen[mealId] = !state.mealPastOpen[mealId];
  renderApp();
};

/* ---- signing up to bring something ----
   Typing must not redraw the page or the field loses focus mid-word, so the
   results are replaced by hand exactly as the day sheet's search does. */
Actions.onMealDishInput = function(mealId, v) {
  /* "draft" is the sheet where a meal is still being written. It has no id
     yet, so its search lives on the draft rather than in the per-meal map. */
  if (mealId === "draft") {
    if (!state.mealDraft) return;
    state.mealDraft.search = v;
    state.mealDraft.pick = null;
    const box = document.getElementById("meal-results-draft");
    if (box) box.innerHTML = MealDraftResultsHTML();
    return;
  }
  state.mealDishSearch[mealId] = v;
  state.mealDishPick[mealId] = null;
  const box = document.getElementById("meal-results-" + mealId);
  const m = mealById(mealId);
  if (box && m) box.innerHTML = MealDishResultsHTML(m);
};
/* Tapping the bringing box on a tile halfway down a long meals page puts the
   iOS keyboard over the field you just tapped, and the browser's own scroll
   correction fires before the keyboard has finished coming up, so the field
   lands wherever the page happened to be. Nudging it into the middle of what
   is left of the viewport after the keyboard settles is the fix: block
   "center" rather than "nearest", because "nearest" considers a field hidden
   behind the keyboard to be already in view. */
function bringIntoView(el) {
  if (!el || !el.scrollIntoView) return;
  try { el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  catch (e) { el.scrollIntoView(); }
}
Actions.focusMealSearch = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  /* Two passes. The first is for the case where the keyboard is already up
     and nothing is going to move; the second catches the resize after it
     opens, which is what actually shifts the field out from under the
     cursor. */
  bringIntoView(el);
  setTimeout(function () { bringIntoView(document.getElementById(id)); }, 320);
};
/* Having picked a recipe, the one thing still being asked for is how many you
   are making, so the cursor goes there rather than leaving you to hunt for a
   58px box that has just appeared below the fold. */
function focusMealServings(mealId) {
  setTimeout(function () {
    const el = document.getElementById("meal-serv-" + mealId);
    if (!el) return;
    el.focus();
    if (el.setSelectionRange) { try { el.setSelectionRange(0, String(el.value).length); } catch (e) {} }
    bringIntoView(el);
  }, 0);
}
Actions.pickMealDish = function(mealId, recipeId) {
  const r = recipeById(recipeId);
  if (!r) { toast("That recipe is no longer there"); return; }
  const pick = { recipeId: recipeId, title: r.title, servings: r.servings.base || 1 };
  if (mealId === "draft") {
    if (!state.mealDraft) return;
    readMealDraftFields();
    state.mealDraft.pick = pick;
    renderModal();
    focusMealServings("draft");
    return;
  }
  state.mealDishPick[mealId] = pick;
  renderApp();
  focusMealServings(mealId);
};
Actions.clearMealDishPick = function(mealId) {
  if (mealId === "draft") {
    if (!state.mealDraft) return;
    readMealDraftFields();
    state.mealDraft.pick = null;
    renderModal();
    return;
  }
  state.mealDishPick[mealId] = null;
  renderApp();
};
Actions.addMealDraftDish = function() {
  const dr = state.mealDraft;
  if (!dr || !dr.pick) return;
  readMealDraftFields();
  const field = document.getElementById("meal-serv-draft");
  const servings = Number(field ? field.value : dr.pick.servings);
  if (!(servings > 0)) { toast("How many are you making?"); return; }
  const r = recipeById(dr.pick.recipeId);
  dr.dishes.push({
    recipeId: dr.pick.recipeId, title: dr.pick.title, servings: servings,
    unit: r ? r.servings.unit : "servings"
  });
  dr.pick = null;
  dr.search = "";
  renderModal();
};
Actions.removeMealDraftDish = function(i) {
  const dr = state.mealDraft;
  if (!dr) return;
  readMealDraftFields();
  dr.dishes.splice(i, 1);
  renderModal();
};
Actions.addMealDish = async function(mealId) {
  const pick = state.mealDishPick[mealId];
  const m = mealById(mealId);
  if (!pick || !m) return;
  const field = document.getElementById("meal-serv-" + mealId);
  const servings = Number(field ? field.value : pick.servings);
  if (!(servings > 0)) { toast("How many are you making?"); return; }
  /* Two people bringing the same thing is allowed. It is worth saying out
     loud first, because at a table it is usually an accident. */
  const clash = m.dishes.filter(function (d) {
    return String(d.title).trim().toLowerCase() === String(pick.title).trim().toLowerCase();
  }).length;
  if (clash && !confirm("Somebody is already bringing " + pick.title +
    ". Add it anyway? The tile will read \\"Lots of " + pick.title + "\\".")) return;
  try {
    await API("meal/dish/add", { mealId, recipeId: pick.recipeId, servings });
    state.mealDishPick[mealId] = null;
    state.mealDishSearch[mealId] = "";
    await refreshLibrary(false);
    toast("On the table, and on your calendar");
  } catch (err) { toast(err.message); }
  renderApp();
};
Actions.removeMealDish = async function(mealId, dishId) {
  try {
    await API("meal/dish/remove", { mealId, dishId });
    await refreshLibrary(false);
    toast("Taken off");
  } catch (err) { toast(err.message); }
  renderApp();
};

Actions.unschedule = async function(entryId) {
  const e = entryById(entryId);
  if (!e) return;
  try {
    await API("schedule/remove", { entryId: entryId });
    state.schedule = state.schedule.filter(x => x.entryId !== entryId);
    if (state.scheduledFor && state.scheduledFor.entryId === entryId) state.scheduledFor = null;
    /* The day sheet is still open behind this if that is where it came from,
       and an empty one has nothing left to say. */
    if (state.modal === "calDay" && scheduleOn(state.calDay).length === 0) {
      state.modal = null;
      state.calDay = null;
    }
    toast("Taken off the calendar");
  } catch (err) { toast(err.message); }
  renderApp();
};

/* --- groceries --- */
/* The two dates cannot cross. Moving one past the other drags the other
   along rather than refusing the input, so there is no way to sit looking at
   a range that cannot be built. */
Actions.setGroceryRange = function(which, value) {
  const v = String(value || "").slice(0, 10);
  state.groceryRange[which] = v;
  if (v) {
    if (which === "start" && state.groceryRange.end && v > state.groceryRange.end) {
      state.groceryRange.end = v;
    } else if (which === "end" && state.groceryRange.start && v < state.groceryRange.start) {
      state.groceryRange.start = v;
    }
  }
  renderApp();
};
Actions.backToGroceries = function() {
  flushGrocerySave();
  state.view = "groceries";
  state.activeListId = null;
  state.groceryMergeFrom = null;
  state.groceryOpenId = null;
  state.grocerySwipedId = null;
  state.grocerySections = { basket: false, removed: false };
  renderApp();
};
Actions.createGroceryList = async function() {
  const rng = state.groceryRange;
  if (!rng.start || !rng.end) { toast("Pick both dates first"); return; }
  if (rng.start > rng.end) { toast("The last day is before the first one"); return; }
  const items = buildGroceryItems(rng.start, rng.end);
  if (!items.length && !confirm("Nothing is scheduled for those days. Build an empty list anyway?")) return;
  const label = uniqueListLabel(rangeLabel(rng.start, rng.end), state.groceryLists);
  state.busy = true;
  try {
    const res = await API("grocery/create", {
      startDate: rng.start, endDate: rng.end, label: label, items: items
    });
    state.groceryLists.push(res.list);
    state.groceryItems[res.list.listId] = items;
    state.activeListId = res.list.listId;
    state.groceryRange = { start: "", end: "" };
    state.view = "grocery";
    toast(items.length + " item" + (items.length === 1 ? "" : "s") + " on the list");
  } catch (e) { toast(e.message); }
  state.busy = false;
  renderApp();
};
Actions.openGroceryList = async function(listId) {
  state.activeListId = listId;
  state.groceryMergeFrom = null;
  state.groceryOpenId = null;
  state.grocerySwipedId = null;
  state.grocerySections = { basket: false, removed: false };
  if (!state.groceryItems[listId]) {
    state.loading = true;
    renderApp();
    try {
      const res = await API("grocery/get", { listId: listId });
      state.groceryItems[listId] = res.items || [];
    } catch (e) { toast(e.message); state.groceryItems[listId] = []; }
    state.loading = false;
  }
  state.view = "grocery";
  renderApp();
};
Actions.openRenameList = function(listId) {
  state.pendingRenameList = listId;
  state.modal = "renameList";
  state.modalError = "";
  renderApp();
};
Actions.saveListName = async function() {
  const listId = state.pendingRenameList;
  const meta = state.groceryLists.filter(L => L.listId === listId)[0];
  if (!meta) { state.modal = null; renderApp(); return; }
  const elm = document.getElementById("rename-list");
  const next = elm ? elm.value.trim().slice(0, 120) : "";
  const was = meta.label;
  /* Painted immediately and put back if the server disagrees, so renaming
     feels like renaming rather than like waiting. */
  meta.label = next || defaultListLabel(meta);
  state.modal = null;
  state.pendingRenameList = null;
  renderApp();
  try {
    await API("grocery/rename", { listId: listId, label: meta.label });
  } catch (e) {
    meta.label = was;
    toast("Couldn't rename that — " + e.message);
    renderApp();
  }
};
/* What the name reverts to when you clear it: the same stamp the list was
   born with, rebuilt from the dates it was made for. */
function defaultListLabel(meta) {
  const made = meta.createdAt ? new Date(meta.createdAt) : new Date();
  return slashDate(meta.startDate) + " - " + slashDate(meta.endDate) + " made at " +
    DOW[made.getDay()] + ", " + MON[made.getMonth()] + " " + made.getDate() + ", " + made.getFullYear() + ", " +
    made.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

Actions.deleteGroceryList = function(listId) {
  state.pendingDeleteList = listId;
  state.modal = "confirmDeleteList";
  state.modalError = "";
  renderApp();
};
Actions.confirmDeleteList = async function() {
  const listId = state.pendingDeleteList;
  if (!listId) return;
  try {
    await API("grocery/delete", { listId: listId });
    state.groceryLists = state.groceryLists.filter(L => L.listId !== listId);
    delete state.groceryItems[listId];
    if (state.activeListId === listId) { state.activeListId = null; state.view = "groceries"; }
    toast("List deleted");
  } catch (e) { toast(e.message); }
  state.pendingDeleteList = null;
  state.modal = null;
  renderApp();
};

/* Every edit to a list writes the whole list back. The lists are small, the
   whole thing is one snapshot anyway, and a partial write would be a way for
   the order and the contents to disagree. Coalesced so dragging a row does
   not turn into a request per frame. */
/* The tab bar gets out of the way going down and comes back coming up. Three
   tabs and a label are about 60px that is only wanted at the moment you go
   looking for it. */
let tabScrollAt = 0, tabsAreDown = false;
function setTabsDown(down) {
  if (tabsAreDown === down) return;
  tabsAreDown = down;
  if (document.body && document.body.classList) document.body.classList.toggle("tabs-down", down);
}
function onAppScroll() {
  const y = scrollAt();
  /* A page with nothing to scroll has nothing to get out of the way of, and
     a dialog is meant to cover the app, tabs included, so neither is a place
     to be hiding things. */
  if (state.modal || scrollRoom() < 80) { setTabsDown(false); tabScrollAt = y; return; }
  const dy = y - tabScrollAt;
  /* Below the jitter threshold the anchor deliberately stays put, so a slow
     deliberate drag still accumulates into a decision instead of being
     rounded away a pixel at a time. */
  if (Math.abs(dy) < 6) return;
  if (dy > 0 && y > 64) setTabsDown(true);
  else if (dy < 0) setTabsDown(false);
  tabScrollAt = y;
}
/* #app is the scroller, and renderApp replaces everything inside it, so the
   scroll position goes with it. Ticking the last thing on a long list and
   being thrown back to the top is not a way anyone can shop, hence this:
   hold the position across the repaint. */
function renderKeepingScroll() {
  const at = scrollAt();
  renderApp();
  scrollToY(at);
  /* Restoring the position fires a scroll event like any other, and the bar
     would read it as a real gesture and flick out of the way on every tick.
     Moving the anchor with it makes that event a zero delta, which needs no
     flag and no timer to unset. */
  tabScrollAt = at;
}

let grocSaveTimer = null;
/* Walking away from a list should not race the debounce. */
function flushGrocerySave() {
  if (!grocSaveTimer) return;
  clearTimeout(grocSaveTimer);
  grocSaveTimer = null;
  const listId = state.activeListId;
  if (!listId) return;
  API("grocery/save", { listId: listId, items: groceryItemsFor(listId) })
    .catch(function (e) { toast("Couldn't save the list — " + e.message); });
}
function saveGroceryItems(listId) {
  const meta = state.groceryLists.filter(L => L.listId === listId)[0];
  if (meta) meta.itemCount = groceryItemsFor(listId).length;
  clearTimeout(grocSaveTimer);
  grocSaveTimer = setTimeout(async function () {
    grocSaveTimer = null;
    try { await API("grocery/save", { listId: listId, items: groceryItemsFor(listId) }); }
    catch (e) { toast("Couldn't save the list — " + e.message); }
  }, 600);
}

Actions.toggleGroceryCheck = function(listId, itemId) {
  state.grocerySwipedId = null;
  state.groceryItems[listId] = groceryItemsFor(listId).map(function (i) {
    return i.id === itemId ? Object.assign({}, i, { checked: !i.checked }) : i;
  });
  state.groceryItems[listId] = normalizeGroceryOrder(state.groceryItems[listId]);
  saveGroceryItems(listId);
  renderKeepingScroll();
};
/* Set aside rather than delete. Nine times in ten "I have that already" is
   the reason, and the tenth is a misfire - either way the line drops to the
   bottom, greys out, and stays recoverable. */
Actions.removeGroceryItem = function(listId, itemId) {
  state.grocerySwipedId = null;
  state.groceryItems[listId] = normalizeGroceryOrder(groceryItemsFor(listId).map(function (i) {
    return i.id === itemId ? Object.assign({}, i, { removed: true, checked: false }) : i;
  }));
  if (state.groceryMergeFrom === itemId) state.groceryMergeFrom = null;
  saveGroceryItems(listId);
  renderKeepingScroll();
};
Actions.restoreGroceryItem = function(listId, itemId) {
  state.grocerySwipedId = null;
  state.groceryItems[listId] = normalizeGroceryOrder(groceryItemsFor(listId).map(function (i) {
    return i.id === itemId ? Object.assign({}, i, { removed: false }) : i;
  }));
  saveGroceryItems(listId);
  renderKeepingScroll();
};
/* The only irreversible one, and it is deliberately two steps: a line has to
   be set aside first, so this button is never next to a line still in play. */
Actions.purgeGroceryItem = function(listId, itemId) {
  state.grocerySwipedId = null;
  state.groceryItems[listId] = groceryItemsFor(listId).filter(i => i.id !== itemId);
  saveGroceryItems(listId);
  renderKeepingScroll();
};
/* Editing either number on a line that carries both. They stay in step by
   proportion, not by conversion: the two values are the pair the recipe
   stated, and there is no table that turns 15 g of cilantro into a quarter
   cup - that ratio is true of cilantro and of nothing else. So halving one
   halves the other, which is right for every ingredient, and no arithmetic
   claims to know more than it does.
   A side with no number to divide by - null, or zero - has no ratio to
   apply, so the other side is left exactly as it was rather than being
   silently zeroed or guessed at. */
Actions.setGroceryQty = function(listId, itemId, segIdx, side, raw) {
  const n = parseFloat(raw);
  const val = (isNaN(n) || n < 0) ? null : n;
  const round = function (x) { return Math.round(x * 1000) / 1000; };
  state.groceryItems[listId] = groceryItemsFor(listId).map(function (i) {
    if (i.id !== itemId) return i;
    /* A hand-added line can arrive with no segments at all; the editor shows
       one empty pair for exactly that case, so make it real on first edit. */
    const base = (i.qty && i.qty.length) ? i.qty : [{ mv: null, mu: "", cv: null, cu: "" }];
    const qty = base.map(function (s, si) {
      if (si !== segIdx) return s;
      const next = { mv: s.mv, mu: s.mu, cv: s.cv, cu: s.cu };
      if (side === "c") {
        const ratio = (s.cv != null && s.cv > 0 && val != null) ? (val / s.cv) : null;
        next.cv = val;
        if (next.mv != null && ratio != null) next.mv = round(next.mv * ratio);
      } else {
        const ratio = (s.mv != null && s.mv > 0 && val != null) ? (val / s.mv) : null;
        next.mv = val;
        if (next.cv != null && ratio != null) next.cv = round(next.cv * ratio);
      }
      return next;
    });
    return Object.assign({}, i, { qty: qty });
  });
  saveGroceryItems(listId);
  renderKeepingScroll();
};

/* Things no recipe asked for: paper towels, a bag of ice, the wine. Unit is
   free text because "2 rolls" is a real quantity and no unit table has rolls
   in it. Stored as an ordinary one-segment line, so it merges and reorders
   like anything else - it simply has no recipe to credit. */
Actions.openAddGroceryItem = function() {
  state.modal = "addGroceryItem";
  state.modalError = "";
  renderApp();
};
Actions.addGroceryItem = function() {
  const listId = state.activeListId;
  if (!listId) return;
  const nameEl = document.getElementById("add-groc-name");
  const qtyEl = document.getElementById("add-groc-qty");
  const unitEl = document.getElementById("add-groc-unit");
  const name = nameEl ? nameEl.value.trim() : "";
  if (!name) { state.modalError = "Give it a name."; renderModal(); return; }
  const raw = qtyEl ? parseFloat(qtyEl.value) : NaN;
  const qtyVal = (isNaN(raw) || raw < 0) ? null : raw;
  const unit = unitEl ? unitEl.value.trim().slice(0, 24) : "";
  const items = groceryItemsFor(listId);
  const item = {
    id: nextGroceryId(items),
    name: name,
    checked: false,
    removed: false,
    from: [],
    qty: (qtyVal == null && !unit) ? [] : [{ mv: qtyVal, mu: unit, cv: null, cu: "" }]
  };
  state.groceryItems[listId] = normalizeGroceryOrder(items.concat([item]));
  saveGroceryItems(listId);
  state.modal = null;
  state.modalError = "";
  renderApp();
  toast(name + " added");
};

/* Open one line's editor, closing whichever was open. The focus is handed to
   the field that was tapped: the name if you tapped the name, the first
   quantity if you tapped the chip. Without that the editor opens and the
   keyboard does not, which reads as nothing having happened. */
Actions.openGroceryRow = function(listId, itemId, focus) {
  state.grocerySwipedId = null;
  const already = state.groceryOpenId === itemId;
  state.groceryOpenId = already ? null : itemId;
  state.groceryOpenFocus = focus || "name";
  renderKeepingScroll();
  if (already) return;
  const id = (state.groceryOpenFocus === "qty" ? "groc-m-" + itemId + "-0" : "groc-name-" + itemId);
  setTimeout(function () {
    const el = document.getElementById(id);
    if (!el) return;
    el.focus();
    if (el.select) { try { el.select(); } catch (e) {} }
  }, 0);
};
Actions.toggleGrocerySection = function(key) {
  state.grocerySections[key] = !state.grocerySections[key];
  state.grocerySwipedId = null;
  renderKeepingScroll();
};
Actions.closeGroceryRow = function() {
  state.groceryOpenId = null;
  state.grocerySwipedId = null;
  renderKeepingScroll();
};
/* Renames the line on this list only. The recipe is untouched on purpose. */
Actions.setGroceryName = function(listId, itemId, raw) {
  const name = String(raw == null ? "" : raw).trim().slice(0, 120);
  if (!name) { toast("A line needs a name"); renderKeepingScroll(); return; }
  state.groceryItems[listId] = groceryItemsFor(listId).map(function (i) {
    return i.id === itemId ? Object.assign({}, i, { name: name }) : i;
  });
  saveGroceryItems(listId);
  renderKeepingScroll();
};

Actions.openExclusions = function() {
  state.exclusionDraft = (state.exclusions || []).slice();
  Actions.openModal("exclusions");
};
Actions.addExclusion = function() {
  const el = document.getElementById("excl-new");
  const raw = el ? String(el.value || "").trim().slice(0, 60) : "";
  if (!raw) { state.modalError = "Type a name first."; renderModal(); return; }
  const draft = state.exclusionDraft || (state.exclusionDraft = []);
  if (draft.some(function (x) { return x.toLowerCase() === raw.toLowerCase(); })) {
    state.modalError = raw + " is already on the list.";
    renderModal();
    return;
  }
  draft.push(raw);
  state.modalError = "";
  renderModal();
  const again = document.getElementById("excl-new");
  if (again) { again.value = ""; again.focus(); }
};
Actions.removeExclusion = function(idx) {
  const draft = state.exclusionDraft || [];
  if (idx < 0 || idx >= draft.length) return;
  draft.splice(idx, 1);
  state.modalError = "";
  renderModal();
};
Actions.saveExclusions = function() {
  const draft = (state.exclusionDraft || []).slice();
  /* Kept locally straight away so Build list behaves as the dialog said it
     would, even if the write is still in flight. */
  state.exclusions = draft;
  state.exclusionDraft = null;
  Actions.closeModal();
  API("grocery/exclusions", { exclusions: draft })
    .then(function (res) { if (res && Array.isArray(res.exclusions)) state.exclusions = res.exclusions; })
    .catch(function (e) { toast("Couldn't save the staples list — " + e.message); });
  toast(draft.length ? (draft.length + " staple" + (draft.length === 1 ? "" : "s") + " left off new lists")
                     : "Nothing will be left off");
};

Actions.openMergeCommon = function() {
  const plan = groceryMergePlan(groceryItemsFor(state.activeListId));
  if (!plan.length) { toast("Nothing on the list looks like a duplicate"); return; }
  state.groceryMergePlan = plan;
  state.groceryOpenId = null;
  state.grocerySwipedId = null;
  Actions.openModal("mergeCommon");
};
Actions.toggleMergePlan = function(idx) {
  const g = (state.groceryMergePlan || [])[idx];
  if (!g) return;
  g.on = !g.on;
  renderModal();
};
Actions.applyMergeCommon = function() {
  const listId = state.activeListId;
  const plan = (state.groceryMergePlan || []).filter(function (g) { return g.on && g.ids.length > 1; });
  if (!plan.length) { Actions.closeModal(); return; }
  let items = groceryItemsFor(listId);
  let folded = 0;
  plan.forEach(function (g) {
    /* Everything folds into the first line of the group, which then takes
       the stripped-down name. Guarded against a line having gone since the
       scan ran - the list is editable behind the dialog. */
    const live = g.ids.filter(function (id) { return items.some(function (i) { return i.id === id; }); });
    if (live.length < 2) return;
    const keep = live[0];
    for (let n = 1; n < live.length; n++) { items = mergeGroceryItems(items, live[n], keep); folded++; }
    items = items.map(function (i) {
      return i.id === keep ? Object.assign({}, i, { name: g.into }) : i;
    });
  });
  state.groceryItems[listId] = normalizeGroceryOrder(items);
  state.groceryMergePlan = [];
  saveGroceryItems(listId);
  Actions.closeModal();
  toast(folded ? ("Folded " + folded + " line" + (folded === 1 ? "" : "s") + " in") : "Nothing left to merge");
};

Actions.beginGroceryMerge = function(itemId) {
  const items = groceryItemsFor(state.activeListId);
  if (items.length < 2) { toast("There is nothing to merge this with"); return; }
  state.groceryMergeFrom = itemId;
  state.groceryOpenId = null;
  renderKeepingScroll();
};
Actions.cancelGroceryMerge = function() { state.groceryMergeFrom = null; renderKeepingScroll(); };
Actions.completeGroceryMerge = function(listId, targetId) {
  const fromId = state.groceryMergeFrom;
  state.groceryMergeFrom = null;
  state.groceryOpenId = null;
  if (!fromId || fromId === targetId) { renderKeepingScroll(); return; }
  const before = groceryItemsFor(listId);
  const after = normalizeGroceryOrder(mergeGroceryItems(before, fromId, targetId));
  state.groceryItems[listId] = after;
  const kept = after.filter(i => i.id === targetId)[0];
  saveGroceryItems(listId);
  renderKeepingScroll();
  if (kept) toast("Merged into " + kept.name);
};

/* Swipe a row left to uncover its action. The hard part is not the animation,
   it is not stealing the scroll: the row must let a vertical drag through to
   the scroller untouched, and only take the gesture once the finger has
   committed sideways. So touch-action:pan-y hands vertical to the browser,
   and the first move that is both past the slop and more sideways than down
   locks the direction for the rest of the gesture - after which it cannot
   change its mind, which is what stops a wobbly finger from juddering
   between scrolling and swiping.
   preventDefault is deliberately not called until that lock: calling it on
   pointerdown would suppress the click, and the tick and the name would stop
   responding to an ordinary tap. */
Actions.swipeDown = function(ev, listId, itemId) {
  if (!ev || ev.pointerType === "mouse" && ev.button !== 0) return;
  const slide = ev.currentTarget;
  const row = slide && slide.parentNode;
  if (!row) return;
  /* Only one row open at a time, and touching another closes it. */
  if (state.grocerySwipedId && state.grocerySwipedId !== itemId) {
    state.grocerySwipedId = null;
    renderKeepingScroll();
    return;
  }
  const startX = ev.clientX, startY = ev.clientY;
  const wasOpen = state.grocerySwipedId === itemId;
  const OPEN = 96, SLOP = 8;
  let dir = null, dx = 0;

  const move = function (e) {
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (!dir) {
      if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return;
      dir = Math.abs(mx) > Math.abs(my) ? "x" : "y";
      if (dir === "y") { done(false); return; }
      row.classList.add("swiping");
    }
    if (e.cancelable) e.preventDefault();
    dx = Math.max(-OPEN, Math.min(0, (wasOpen ? -OPEN : 0) + mx));
    slide.style.transform = "translateX(" + dx + "px)";
  };
  const up = function () { done(true); };
  const done = function (settle) {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", up);
    row.classList.remove("swiping");
    slide.style.transform = "";
    if (!settle || dir !== "x") return;
    /* Past halfway it stays open, short of it springs back. */
    const open = dx <= -OPEN / 2;
    const next = open ? itemId : null;
    if (state.grocerySwipedId !== next) { state.grocerySwipedId = next; renderKeepingScroll(); }
  };
  document.addEventListener("pointermove", move, { passive: false });
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", up);
};

/* Drag to reorder, by hand. The HTML5 drag events never fire for a finger on
   iOS, so this is pointer events: the row is moved in the DOM as the finger
   passes the midpoint of its neighbours, and where it ends up is read back on
   release. touch-action:none on the handle is what stops the scroller from
   claiming the gesture before the first pointermove arrives. */
Actions.gripDown = function(ev, listId, itemId) {
  if (!ev || !document.getElementById("groc-items")) return;
  if (ev.preventDefault) ev.preventDefault();
  if (ev.stopPropagation) ev.stopPropagation();
  const ul = document.getElementById("groc-items");
  const rowOf = function (id) {
    const all = Array.prototype.slice.call(ul.querySelectorAll(".groc-row"));
    return all.filter(function (n) { return n.getAttribute("data-id") === id; })[0] || null;
  };
  const row = rowOf(itemId);
  if (!row) return;
  /* An open editor is a second element that does not travel with the row it
     belongs to, so the drag would leave it sitting under someone else. */
  if (state.groceryOpenId || state.grocerySwipedId) {
    state.groceryOpenId = null; state.grocerySwipedId = null; renderKeepingScroll();
  }
  const row2 = rowOf(itemId);
  if (!row2) return;
  row2.classList.add("groc-dragging");
  const onMove = function (e) {
    if (e.preventDefault) e.preventDefault();
    const y = (e.clientY != null) ? e.clientY
      : (e.touches && e.touches[0] ? e.touches[0].clientY : null);
    if (y == null) return;
    const others = Array.prototype.slice.call(ul.querySelectorAll(".groc-row"))
      .filter(function (n) { return n !== row2; });
    let before = null;
    for (const n of others) {
      const b = n.getBoundingClientRect();
      if (y < b.top + b.height / 2) { before = n; break; }
    }
    if (before) ul.insertBefore(row2, before);
    else ul.appendChild(row2);
  };
  const onUp = function () {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    row2.classList.remove("groc-dragging");
    const order = Array.prototype.slice.call(ul.querySelectorAll(".groc-row"));
    const toIndex = order.indexOf(row2);
    if (toIndex >= 0) {
      state.groceryItems[listId] =
        normalizeGroceryOrder(reorderGroceryItems(groceryItemsFor(listId), itemId, toIndex));
      saveGroceryItems(listId);
    }
    renderKeepingScroll();
  };
  document.addEventListener("pointermove", onMove, { passive: false });
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
};

window.Actions = Actions;

/* ====================================================================== */
/* Init                                                                    */
/* ====================================================================== */
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("visibilitychange", function() {
    if (!document.hidden) pollWatched();
  });
}
/* The toolbar sliding in or out, the keyboard arriving, a rotation: each one
   changes the visible area without the page laying out again, so the overlay
   has to be told. resize covers the height changes and scroll covers the
   visible area shifting under a pinch. Cheap enough to leave running rather
   than wiring up and tearing down around each modal. */
/* #app outlives every render - only its contents are replaced - so this
   binds once and never needs rewiring. */
if (typeof document !== "undefined" && document.getElementById) {
  const scroller = scrollBox();
  if (scroller && scroller.addEventListener) {
    scroller.addEventListener("scroll", onAppScroll, { passive: true });
  } else if (typeof window !== "undefined" && window.addEventListener) {
    /* In a tab the scroll events are the document's, and they arrive on
       window. #app outlives every render either way, so this still binds
       once and never needs rewiring. */
    window.addEventListener("scroll", onAppScroll, { passive: true });
  }
}
if (typeof window !== "undefined" && window.visualViewport && window.addEventListener) {
  const vvport = window.visualViewport;
  vvport.addEventListener("resize", syncViewportVars);
  vvport.addEventListener("scroll", syncViewportVars);
  window.addEventListener("orientationchange", syncViewportVars);
  syncViewportVars();
}
/* Closing the tab should free the recipe rather than leave it locked for
   the full timeout. Best effort: this does not always fire on mobile,
   which is exactly why locks expire on their own as well. */
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("pagehide", function() {
    if (!state.lockHeld || !state.session || !navigator.sendBeacon) return;
    try {
      navigator.sendBeacon("/api/recipe/unlock", new Blob([JSON.stringify({
        username: state.session.username,
        cookbookId: state.session.cookbookId,
        recipeId: state.lockHeld
      })], { type: "application/json" }));
    } catch (e) {}
  });
}

/* A drag in from the left edge does what the chevron at the top of the view
   does: out of an open recipe, off the Friends page, back from a shopping
   list to the lists. On each of them that chevron is a reach on a phone, and
   once the page has been scrolled it is off the screen entirely, so the
   gesture is the only way out that is always to hand.
   Two layers move while the finger is down: the view being left, dragged
   along one for one, and behind it the view being returned to, held back at
   a fraction of the speed so it comes out from underneath rather than
   travelling with it. Let go past the mark and both run on to the end before
   the real render happens; let go short of it and both fall back.
   Bound once on the document rather than on the view: #app is emptied and
   refilled on every render, so anything held by the view itself would need
   rewiring each time. Touch events rather than pointer events - a mouse
   drifting past the edge should not start it, and the two dragging gestures
   that already exist take pointerdown on their own elements first.
   In a browser tab iOS claims left-edge drags for its own back gesture and
   this simply never fires, which is the right outcome: there the swipe still
   goes back, just by the browser's reckoning rather than ours. */
if (typeof document !== "undefined" && document.addEventListener) {
  const EDGE_ZONE = 28;      /* how far in from the edge a drag may begin */
  const EDGE_SLOP = 8;       /* travel before the direction is settled on */
  const EDGE_TAKE = 72;      /* travel before the drag counts as going back */
  const PARALLAX  = 0.28;    /* how far behind the page underneath hangs */
  const RUN_MS    = 260;     /* the .24s in the stylesheet, plus a hair */

  /* Where back goes from each view, and what is behind you while you drag.
     Both halves are the ones the app already uses - the same call the
     chevron makes, and the same function renderApp would reach for - so the
     preview cannot drift out of step with what actually lands.
     Views not listed have no way back for a drag to stand in for: the
     library, the calendar and the list of shopping lists are all somewhere
     you arrive at by tab rather than by opening something, and the editor is
     left through Save or Cancel on purpose - a stray drag must not be able
     to throw away an afternoon's typing. */
  const BACK_FROM = {
    detail:  { go: function () { Actions.backToLibrary(); },   under: LibraryViewHTML },
    friends: { go: function () { Actions.backToLibrary(); },   under: LibraryViewHTML },
    grocery: { go: function () { Actions.backToGroceries(); }, under: GroceriesViewHTML }
  };
  /* What the gesture moves and what it does at the end of the pull, or
     nothing at all if it does not apply here. A modal owns the screen while
     it is up. */
  const dragTarget = function () {
    if (!state.session || state.loading || state.modal) return null;
    const route = BACK_FROM[state.view];
    if (!route) return null;
    /* A shopping line swiped open is holding a sideways gesture of its own,
       and pulling back to the right is how it is put away again. It gets to
       finish before the page will answer to the same movement. */
    if (state.view === "grocery" && state.grocerySwipedId) return null;
    const app = document.getElementById("app");
    const el = app ? app.querySelector(".wrap") : null;
    return el ? { el: el, route: route } : null;
  };
  /* A strip already scrolled sideways - the tag row - has first claim on the
     gesture. Once it is back against its own left edge the page takes over. */
  const heldSideways = function (node) {
    let n = node;
    while (n && n.nodeType === 1 && n !== document.body) {
      if (n.scrollWidth > n.clientWidth + 1 && n.scrollLeft > 0) return true;
      n = n.parentNode;
    }
    return false;
  };
  const windowWidth = function () {
    const vv = (typeof window !== "undefined") ? window.visualViewport : null;
    return (vv && vv.width) ||
      (document.documentElement && document.documentElement.clientWidth) ||
      (typeof window !== "undefined" && window.innerWidth) || 360;
  };

  let front = null, route = null, ghost = null, shade = null;
  let startX = 0, startY = 0, dir = null, dx = 0, width = 0;
  let runTimer = 0, runThen = null;

  /* Everything back the way it was found. Safe to call on a gesture that
     never started, and safe to call twice. */
  const teardown = function () {
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    if (front) {
      front.classList.remove("sb-front", "sb-anim");
      front.style.transform = "";
    }
    front = null; route = null; ghost = null; shade = null;
    dir = null; dx = 0; width = 0;
  };
  /* The tail of the movement, brought forward. Called by the timer when it
     runs out, and by a finger that lands before it does - either way the
     thing the animation was on its way to doing still gets done. */
  const finishRun = function () {
    if (!runTimer) return;
    clearTimeout(runTimer); runTimer = 0;
    const then = runThen; runThen = null;
    /* The layers go before the render, not after: for a moment the ghost and
       the real thing would be two copies of one view in the same document,
       sharing every id in it. Nothing paints in between, so nothing shows. */
    teardown();
    if (then) then();
  };

  /* The view being returned to, drawn behind the one being left. Built when
     the drag is recognised rather than when the finger lands: every tap near
     the left edge would otherwise pay for a whole view being built and
     thrown away, and on the shopping list the left edge is where the
     tickboxes are. */
  const raiseGhost = function (build) {
    const app = document.getElementById("app");
    if (!app || !app.parentNode) return;
    let html;
    try { html = build(); } catch (e) { return; }   /* no preview beats no gesture */
    const layer = document.createElement("div");
    layer.className = "sb-back";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = html;
    const dim = document.createElement("div");
    dim.className = "sb-dim";
    layer.appendChild(dim);
    app.parentNode.insertBefore(layer, app.nextSibling);
    ghost = layer; shade = dim;
  };

  /* One place that turns how far the finger has travelled into where the two
     layers sit. Used by the drag and by both endings. */
  const place = function () {
    if (!front) return;
    if (front.isConnected === false) { teardown(); return; }
    const through = width ? dx / width : 0;
    front.style.transform = "translateX(" + dx + "px)";
    if (ghost) ghost.style.transform = "translateX(" + (-PARALLAX * (width - dx)) + "px)";
    if (shade) shade.style.opacity = String(1 - through);
  };
  const runTo = function (target, then) {
    if (!front) return;
    front.classList.add("sb-anim");
    if (ghost) ghost.classList.add("sb-anim");
    if (shade) shade.classList.add("sb-anim");
    void front.offsetWidth;              /* so the move is animated, not jumped */
    dx = target;
    place();
    runThen = then;
    runTimer = setTimeout(finishRun, RUN_MS);
  };

  document.addEventListener("touchstart", function (e) {
    finishRun();                         /* a finger landing mid-flight lands it */
    teardown();
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > EDGE_ZONE) return;
    if (heldSideways(e.target)) return;
    const hit = dragTarget();
    if (!hit) return;
    front = hit.el; route = hit.route; startX = t.clientX; startY = t.clientY;
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (!front) return;
    if (!e.touches || e.touches.length !== 1) {
      /* A second finger means a pinch, not a back swipe. Anything already
         pulled falls back; anything not yet moving is simply dropped. */
      if (dir === "x") runTo(0, null); else teardown();
      return;
    }
    const t = e.touches[0];
    const mx = t.clientX - startX, my = t.clientY - startY;
    if (!dir) {
      if (Math.abs(mx) < EDGE_SLOP && Math.abs(my) < EDGE_SLOP) return;
      /* Anything but a clear pull to the right is the scroller's. */
      if (mx <= 0 || Math.abs(my) >= Math.abs(mx)) { teardown(); return; }
      dir = "x";
      width = windowWidth();
      front.classList.add("sb-front");
      raiseGhost(route.under);
    }
    if (e.cancelable) e.preventDefault();
    /* Follows the finger one for one, and never past either end - dragging
       back the other way undoes the pull rather than pushing the page off
       the far side, and there is nothing beyond a full screen's travel. */
    dx = Math.max(0, Math.min(width, mx));
    place();
  }, { passive: false });

  const release = function () {
    if (!front) return;
    if (dir !== "x") { teardown(); return; }
    if (dx >= EDGE_TAKE) runTo(width, route.go);
    else runTo(0, null);
  };
  document.addEventListener("touchend", release);
  document.addEventListener("touchcancel", release);
}
(async function init() {
 try {
  const scanned = readIntentFromUrl();
  state.session = loadSession();
  if (!state.session) {
    state.loading = false;
    /* A recipe link is readable without an account, so it opens rather than
       waiting behind the sign-in screen. A friend code still has to wait -
       there is no one to send the request from yet. */
    if (scanned && scanned.type === "recipe") { await Actions.beginIntent(scanned); return; }
    if (scanned) { stashIntent(scanned); state._arrivedByScan = true; }
    renderApp();
    return;
  }
  await refreshLibrary(true);
  /* A code scanned just now wins over one left over from an abandoned visit. */
  const intent = scanned || takeStashedIntent();
  if (intent) await Actions.beginIntent(intent);
 } catch (e) {
  /* Boot failing used to mean a white page and nothing else. Say what
     happened, and leave a way back to the front door. */
  const app = document.getElementById("app");
  if (app) {
    app.innerHTML = '<div class="wrap"><h1 class="detail-title font-display">Could not start</h1>' +
      '<p class="helper-text">The app failed to load. This is a bug worth reporting.</p>' +
      '<div class="code-box font-mono" style="text-align:left;word-break:break-word">' +
        esc(String((e && e.message) || e)) + '</div>' +
      '<button class="btn btn-primary btn-block" style="margin-top:12px" ' +
        'onclick="location.reload()">Try again</button></div>';
  }
  throw e;
 }
})();
</script>
</body>
</html>
`;

/* ====================================================================== */
/* Server                                                                  */
/* ====================================================================== */

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
    this.detail = null;
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: JSON_HEADERS });
}

const COOKBOOK_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const RECIPE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function randomFrom(alphabet, length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
const newRecipeId = () => randomFrom(RECIPE_ALPHABET, 14);
const newCommentId = () => randomFrom(RECIPE_ALPHABET, 16);
const newEntryId = () => randomFrom(RECIPE_ALPHABET, 16);
const newListId = () => randomFrom(RECIPE_ALPHABET, 16);
const newMealId = () => randomFrom(RECIPE_ALPHABET, 16);
const newDishId = () => randomFrom(RECIPE_ALPHABET, 16);

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,19}$/;
const COOKBOOK_RE = /^[A-Z0-9]{10}$/;
/* Three tiers, in increasing order of reach:
     private   - nobody outside the cookbook. No link, no code, no handing out.
     selective - only the cookbooks the owner ticked. Link and code allowed.
     friends   - every friend of the cookbook. Link and code allowed.
   "selective" arrived after the other two. Before it existed, handing a
   recipe to particular friends was expressed as private-plus-rows-in-
   recipe_shares, which is exactly what selective means, so those recipes are
   migrated across. The migration is safe to run repeatedly because setting a
   recipe back to private clears its shares, which keeps the invariant it
   relies on: a private recipe never has share rows. */
const VISIBILITIES = ["private", "selective", "friends"];
const VISIBILITY_MIGRATION =
  "UPDATE recipes SET visibility = 'selective' WHERE visibility = 'private' " +
  "AND recipe_id IN (SELECT recipe_id FROM recipe_shares)";
/* Only these two can be handed out beyond the cookbook, so only these two get
   a link and a QR code. */
function isShareable(visibility) { return visibility === "friends" || visibility === "selective"; }
const MAX_RECIPE_BYTES = 96 * 1024;
const MAX_IMPORT_RECIPES = 400;
const MAX_COMMENT_CHARS = 2000;

/* How long an editing lock survives without being refreshed. Long enough to
   ride out a screen lock, short enough that a closed tab frees the recipe. */
const LOCK_TTL_MS = 5 * 60 * 1000;

/* Friend-lookup throttling: 30 failed attempts per 10 minutes, counted
   independently against the caller's cookbook and their IP address. */
const RL_WINDOW_MS = 10 * 60 * 1000;
const RL_MAX_FAILURES = 30;

function placeholders(n) { return new Array(n).fill("?").join(","); }

function cleanString(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max || 500) : "";
}

/* ---------------------------------------------------------------- auth -- */
async function requireAuth(env, body) {
  const username = cleanString(body.username, 40);
  const cookbookId = cleanString(body.cookbookId, 40).toUpperCase();
  if (!username || !cookbookId) throw new ApiError(401, "Sign in again to continue.", "AUTH");
  const row = await env.DB.prepare(
    "SELECT username, username_lc, cookbook_id FROM users WHERE username_lc = ?"
  ).bind(username.toLowerCase()).first();
  if (!row || row.cookbook_id !== cookbookId) {
    throw new ApiError(401, "That username and Cookbook ID don't go together.", "AUTH");
  }
  return { username: row.username, usernameLc: row.username_lc, cookbookId: row.cookbook_id };
}

/* ------------------------------------------------------------ throttle -- */
async function throttleGuard(env, buckets) {
  const now = Date.now();
  for (const bucket of buckets) {
    const row = await env.DB.prepare(
      "SELECT window_start, count FROM rate_limits WHERE bucket = ?"
    ).bind(bucket).first();
    if (row && (now - row.window_start) < RL_WINDOW_MS && row.count >= RL_MAX_FAILURES) {
      const mins = Math.max(1, Math.ceil((RL_WINDOW_MS - (now - row.window_start)) / 60000));
      throw new ApiError(429, "Too many failed name lookups. Try again in " + mins + " minute" + (mins === 1 ? "" : "s") + ".");
    }
  }
}
async function throttleRecordFailure(env, buckets) {
  const now = Date.now();
  for (const bucket of buckets) {
    const row = await env.DB.prepare(
      "SELECT window_start FROM rate_limits WHERE bucket = ?"
    ).bind(bucket).first();
    if (!row || (now - row.window_start) >= RL_WINDOW_MS) {
      await env.DB.prepare(
        "INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1) " +
        "ON CONFLICT(bucket) DO UPDATE SET window_start = excluded.window_start, count = 1"
      ).bind(bucket, now).run();
    } else {
      await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket = ?").bind(bucket).run();
    }
  }
}

/* ------------------------------------------------------------- friends -- */
/* Friendships link COOKBOOKS, not people: every member of a cookbook is
   linked to every member of the cookbooks it has befriended, and anyone who
   joins later inherits those links.

   A Cookbook ID is a password, so it must never reach the client. The app
   therefore refers to another cookbook by the username of one of its
   members, and the server resolves that to a cookbook itself. */
async function friendCookbooks(env, cookbookId) {
  const rows = await env.DB.prepare(
    "SELECT CASE WHEN requester_cb = ? THEN addressee_cb ELSE requester_cb END AS cb " +
    "FROM friendships WHERE status = 'accepted' AND (requester_cb = ? OR addressee_cb = ?)"
  ).bind(cookbookId, cookbookId, cookbookId).all();
  return (rows.results || []).map(r => r.cb);
}

/* cookbook id -> [display usernames], for every cookbook asked about */
async function membersOf(env, cookbookIds) {
  const ids = Array.from(new Set(cookbookIds.filter(Boolean)));
  const map = {};
  if (!ids.length) return map;
  const rows = await env.DB.prepare(
    "SELECT username, cookbook_id FROM users WHERE cookbook_id IN (" +
    placeholders(ids.length) + ") ORDER BY username COLLATE NOCASE"
  ).bind(...ids).all();
  for (const r of rows.results || []) {
    (map[r.cookbook_id] = map[r.cookbook_id] || []).push(r.username);
  }
  return map;
}

/* One cookbook, one name. Members joined alphabetically, e.g. "cori | richard".
   A cookbook is credited, filtered and listed as a single household, because
   sharing a Cookbook ID means sharing recipes, friends and credit alike. */
function householdLabel(names) {
  return (names || []).slice()
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .join(" | ");
}

async function countMembers(env, cookbookId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE cookbook_id = ?"
  ).bind(cookbookId).first();
  return row ? Number(row.n) : 0;
}

async function findUser(env, name) {
  return await env.DB.prepare(
    "SELECT username, username_lc, cookbook_id FROM users WHERE username_lc = ?"
  ).bind(String(name || "").trim().toLowerCase()).first();
}

/* Resolve the username the client sent to the cookbook it belongs to. */
async function resolveCookbook(env, name) {
  const them = await findUser(env, name);
  if (!them) throw new ApiError(404, "No one here goes by that name.");
  return them;
}

/* ---------------------------------------------------------- recipe rows -- */
/* Private has to mean private by whichever door it was set. Withdrawing the
   individual hand-outs and the link pins is not housekeeping - it is what
   the tier means, and the library query reads both tables. It also keeps the
   invariant the selective migration leans on: a private recipe never has
   share rows. Miss this on one route and a recipe edited down to private
   would keep its old audience and then be promoted back to selective on the
   next cold start. */
async function applyVisibilityReach(env, recipeId, visibility) {
  if (visibility !== "private") return;
  await env.DB.prepare("DELETE FROM recipe_shares WHERE recipe_id = ?").bind(recipeId).run();
  await env.DB.prepare("DELETE FROM link_grants WHERE recipe_id = ?").bind(recipeId).run();
}

async function loadRecipeForReader(env, me, recipeId) {
  const row = await env.DB.prepare(
    "SELECT recipe_id, cookbook_id, owner_username, owner_lc, visibility, data, created_at, updated_at, updated_by, locked_by, locked_at " +
    "FROM recipes WHERE recipe_id = ?"
  ).bind(recipeId).first();
  if (!row) throw new ApiError(404, "That recipe is no longer there.");
  if (row.cookbook_id === me.cookbookId) return { row, ours: true };
  if (!(await reachesReader(env, me.cookbookId, row, recipeId))) {
    throw new ApiError(403, "That recipe isn't shared with you.");
  }
  return { row, ours: false };
}

function liveLockHolder(row, me) {
  if (!row || !row.locked_by || !row.locked_at) return null;
  if (row.locked_by === me.username) return null;
  if (Date.now() - Date.parse(row.locked_at) >= LOCK_TTL_MS) return null;
  return row.locked_by;
}

function validateRecipeData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(400, "The recipe was not readable.");
  const title = cleanString(data.title, 200);
  if (!title) throw new ApiError(400, "The recipe needs a title.");
  const text = JSON.stringify(data);
  if (text.length > MAX_RECIPE_BYTES) throw new ApiError(413, "That recipe is too big to store.");
  return { title, text };
}

/* ================================================================ API === */
/* Marks and private shares arrived after the original schema, so the tables
   are created on demand rather than by hand in the D1 console. Cheap: one
   pass per isolate. */
const LATER_TABLES = [
  "CREATE TABLE IF NOT EXISTS recipe_marks ( cookbook_id TEXT NOT NULL, recipe_id TEXT NOT NULL, " +
    "kind TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, " +
    "PRIMARY KEY (cookbook_id, recipe_id, kind) )",
  "CREATE INDEX IF NOT EXISTS idx_marks_cookbook ON recipe_marks(cookbook_id, kind)",
  "CREATE INDEX IF NOT EXISTS idx_marks_recipe ON recipe_marks(recipe_id)",
  "CREATE TABLE IF NOT EXISTS recipe_shares ( recipe_id TEXT NOT NULL, cookbook_id TEXT NOT NULL, " +
    "created_at TEXT NOT NULL, PRIMARY KEY (recipe_id, cookbook_id) )",
  "CREATE INDEX IF NOT EXISTS idx_shares_cookbook ON recipe_shares(cookbook_id)",
  /* Someone opened a share link and pinned what they found. That has to be
     recorded somewhere the owner's own sharing checkboxes cannot destroy:
     recipe/share rewrites recipe_shares for a recipe wholesale, so a grant
     kept there would vanish out of a stranger's cookbook the next time the
     owner edited who they had ticked. Hence a table of its own. */
  "CREATE TABLE IF NOT EXISTS link_grants ( recipe_id TEXT NOT NULL, cookbook_id TEXT NOT NULL, " +
    "created_at TEXT NOT NULL, PRIMARY KEY (recipe_id, cookbook_id) )",
  "CREATE INDEX IF NOT EXISTS idx_grants_cookbook ON link_grants(cookbook_id)",
  /* A pin that is waiting on a friendship. Scanning a recipe code from
     outside somebody's circle cannot pin anything yet, so the wish is kept
     here and settled the moment the link exists. */
  "CREATE TABLE IF NOT EXISTS pending_pins ( cookbook_id TEXT NOT NULL, recipe_id TEXT NOT NULL, " +
    "created_at TEXT NOT NULL, PRIMARY KEY (cookbook_id, recipe_id) )",
  "CREATE INDEX IF NOT EXISTS idx_pending_pins_recipe ON pending_pins(recipe_id)",
  /* The meal plan. Keyed to the cookbook, not the person, so a household
     keeps one calendar. The title is a snapshot: if the recipe is deleted or
     a friend stops sharing it, the square still says what was planned there
     rather than silently emptying. */
  "CREATE TABLE IF NOT EXISTS schedule_entries ( entry_id TEXT PRIMARY KEY, cookbook_id TEXT NOT NULL, " +
    "recipe_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', on_date TEXT NOT NULL, " +
    "servings REAL NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_sched_cookbook ON schedule_entries(cookbook_id, on_date)",
  "CREATE INDEX IF NOT EXISTS idx_sched_recipe ON schedule_entries(recipe_id)",
  /* A shopping list, items and all, as one JSON snapshot. Ticks, merges,
     deletions and the aisle order are all edits to the same frozen document,
     so splitting them across rows would only be a way for the order and the
     contents to get out of step. item_count is kept alongside so the index
     can be listed without reading every blob. */
  "CREATE TABLE IF NOT EXISTS grocery_lists ( list_id TEXT PRIMARY KEY, cookbook_id TEXT NOT NULL, " +
    "label TEXT NOT NULL DEFAULT '', start_date TEXT NOT NULL, end_date TEXT NOT NULL, " +
    "items TEXT NOT NULL DEFAULT '[]', item_count INTEGER NOT NULL DEFAULT 0, " +
    "created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_glists_cookbook ON grocery_lists(cookbook_id, created_at)",
  /* Cookbook-wide settings, one row per cookbook rather than per person: the
     staples you never need to be told to buy are a property of the kitchen,
     not of whoever happened to press Build list. */
  "CREATE TABLE IF NOT EXISTS cookbook_prefs ( cookbook_id TEXT PRIMARY KEY, " +
    "exclusions TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL )",
  /* A meal cooked between cookbooks. Owned by a cookbook rather than a
     person, like everything else here, so either half of a household can run
     it. The date and time are plain local strings with no zone: a dinner is
     at six wherever you are reading about it from. */
  "CREATE TABLE IF NOT EXISTS community_meals ( meal_id TEXT PRIMARY KEY, owner_cb TEXT NOT NULL, " +
    "title TEXT NOT NULL DEFAULT '', on_date TEXT NOT NULL, at_time TEXT NOT NULL DEFAULT '', " +
    "description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', " +
    "created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_meals_owner ON community_meals(owner_cb, on_date)",
  /* One row per cookbook on the guest list, the owner included. Membership is
     what grants sight of the meal, which is why two guests who have never
     met can still read each other's names off the same tile. */
  "CREATE TABLE IF NOT EXISTS meal_guests ( meal_id TEXT NOT NULL, cookbook_id TEXT NOT NULL, " +
    "status TEXT NOT NULL, invited_by TEXT NOT NULL, responded_by TEXT, updated_at TEXT NOT NULL, " +
    "PRIMARY KEY (meal_id, cookbook_id) )",
  "CREATE INDEX IF NOT EXISTS idx_mguests_cb ON meal_guests(cookbook_id, status)",
  /* What somebody is bringing. entry_id points at the schedule_entries row
     the commitment created, which is how the dish reaches the cook's own
     calendar and from there the shopping list. The reference hangs off this
     side rather than adding a column to schedule_entries, so the table that
     is already live in production is never altered. The title is a snapshot
     for the same reason the calendar keeps one: a guest can read what
     somebody is bringing without being able to open the recipe. */
  "CREATE TABLE IF NOT EXISTS meal_dishes ( dish_id TEXT PRIMARY KEY, meal_id TEXT NOT NULL, " +
    "cookbook_id TEXT NOT NULL, recipe_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', " +
    "entry_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_mdishes_meal ON meal_dishes(meal_id)",
  "CREATE INDEX IF NOT EXISTS idx_mdishes_entry ON meal_dishes(entry_id)"
];

/* What a kitchen is assumed to have until it says otherwise. Seeded on read
   rather than written at signup, so a cookbook that predates the feature
   gets them too. Once the list has been saved even once - emptied included -
   the stored answer wins and these are never reapplied. */
const DEFAULT_EXCLUSIONS = ["Water", "Salt", "Black pepper", "Baking soda", "Ice"];
const MAX_EXCLUSIONS = 200;
let schemaReady = false;
/* community_meals shipped before it had anything to say beyond a name and a
   day. The table is already live, so the two later columns are added rather
   than declared: CREATE TABLE IF NOT EXISTS never runs again once the table
   exists, and would leave a cookbook created last month without them. SQLite
   has no ADD COLUMN IF NOT EXISTS, and a duplicate column is the expected
   result on every run after the first, so that one error is swallowed and
   anything else is not. */
const LATER_COLUMNS = [
  "ALTER TABLE community_meals ADD COLUMN description TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE community_meals ADD COLUMN location TEXT NOT NULL DEFAULT ''"
];
async function addLaterColumns(env) {
  for (const sql of LATER_COLUMNS) {
    try { await env.DB.prepare(sql).run(); }
    catch (e) {
      if (!/duplicate column/i.test(String(e && e.message))) throw e;
    }
  }
  await env.DB.prepare(VISIBILITY_MIGRATION).run();
}
async function ensureSchema(env) {
  if (schemaReady) return;
  for (const sql of LATER_TABLES) await env.DB.prepare(sql).run();
  await addLaterColumns(env);
  schemaReady = true;
}

const MARK_KINDS = ["pin", "star", "later"];

/* Every meal this cookbook is on the guest list for, with its whole guest
   list and everything anyone is bringing. Membership is the only permission
   involved: two guests who are not friends still read the same tile, because
   a shared dinner is not a private thing between each pair of people at it.
   What crosses that line is deliberately narrow - a household name and a
   dish title. No recipe, no servings, no cookbook contents. */
async function mealsFor(env, cookbookId) {
  const mine = (await env.DB.prepare(
    "SELECT meal_id, status, updated_at FROM meal_guests " +
    "WHERE cookbook_id = ? AND status != 'declined'"
  ).bind(cookbookId).all()).results || [];
  if (!mine.length) return { meals: [], cookbooks: [] };
  const ids = mine.map(r => r.meal_id);
  const myStatus = {}, myAt = {};
  for (const r of mine) { myStatus[r.meal_id] = r.status; myAt[r.meal_id] = r.updated_at; }

  const metaRows = (await env.DB.prepare(
    "SELECT meal_id, owner_cb, title, on_date, at_time, description, location, " +
    "created_by, created_at, updated_at " +
    "FROM community_meals WHERE meal_id IN (" + placeholders(ids.length) + ")"
  ).bind(...ids).all()).results || [];
  const guestRows = (await env.DB.prepare(
    "SELECT meal_id, cookbook_id, status, updated_at FROM meal_guests WHERE meal_id IN (" +
    placeholders(ids.length) + ")"
  ).bind(...ids).all()).results || [];
  const dishRows = (await env.DB.prepare(
    "SELECT dish_id, meal_id, cookbook_id, recipe_id, title, entry_id, created_by, created_at " +
    "FROM meal_dishes WHERE meal_id IN (" + placeholders(ids.length) + ") ORDER BY created_at"
  ).bind(...ids).all()).results || [];

  /* Guest cookbooks need names, and they are not necessarily friends of
     ours, so they are collected here rather than borrowed from the friend
     list the library already built. */
  const cookbooks = Array.from(new Set(
    metaRows.map(r => r.owner_cb).concat(guestRows.map(r => r.cookbook_id), dishRows.map(r => r.cookbook_id))
  ));
  return { meals: { metaRows, guestRows, dishRows, myStatus, myAt }, cookbooks };
}

/* The rows above, shaped for the client once labels are known. */
function shapeMeals(raw, labelFor, cookbookId) {
  if (!raw || !raw.metaRows) return [];
  const { metaRows, guestRows, dishRows, myStatus, myAt } = raw;
  const byMeal = {}, dishesBy = {};
  for (const g of guestRows) (byMeal[g.meal_id] = byMeal[g.meal_id] || []).push(g);
  for (const d of dishRows) (dishesBy[d.meal_id] = dishesBy[d.meal_id] || []).push(d);
  return metaRows.map(m => ({
    mealId: m.meal_id,
    title: m.title,
    /* Both arrived after the table did, so a meal written before they existed
       reads as an empty string rather than a null the tile would have to
       guard against. */
    description: m.description || "",
    location: m.location || "",
    date: m.on_date,
    time: m.at_time,
    ownerLabel: labelFor(m.owner_cb),
    ours: m.owner_cb === cookbookId,
    myStatus: myStatus[m.meal_id] || "invited",
    /* When our seat was last written. An invitation reopened after a decline
       gets a fresh stamp, so a notification cleared the first time round does
       not swallow the second asking. */
    seatAt: (myAt && myAt[m.meal_id]) || m.created_at,
    createdBy: m.created_by,
    createdAt: m.created_at,
    guests: (byMeal[m.meal_id] || [])
      /* updatedAt is what lets the host be told about an acceptance exactly
         once: it is the stamp on that one seat, so a guest who declines and
         is asked again and then accepts raises a second piece of news rather
         than being swallowed by the first. */
      .map(g => ({
        label: labelFor(g.cookbook_id), status: g.status,
        mine: g.cookbook_id === cookbookId, updatedAt: g.updated_at
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    dishes: (dishesBy[m.meal_id] || []).map(d => ({
      dishId: d.dish_id,
      label: labelFor(d.cookbook_id),
      by: d.created_by,
      title: d.title,
      /* A dish brought by somebody else is a title and nothing more: the
         recipe id would only invite a tap that cannot open anything. */
      recipeId: d.cookbook_id === cookbookId ? d.recipe_id : null,
      entryId: d.cookbook_id === cookbookId ? d.entry_id : null,
      mine: d.cookbook_id === cookbookId
    }))
  })).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/* Guest rows for one meal, and whether this cookbook may act on it. */
async function mealSeat(env, mealId, cookbookId) {
  const meal = await env.DB.prepare(
    "SELECT meal_id, owner_cb, title, on_date, at_time FROM community_meals WHERE meal_id = ?"
  ).bind(mealId).first();
  if (!meal) throw new ApiError(404, "That meal is gone.");
  const seat = await env.DB.prepare(
    "SELECT status FROM meal_guests WHERE meal_id = ? AND cookbook_id = ?"
  ).bind(mealId, cookbookId).first();
  if (!seat) throw new ApiError(403, "You are not on that meal.");
  return { meal, status: seat.status, isOwner: meal.owner_cb === cookbookId };
}

/* Dropping a cookbook from a meal takes its dishes and, with them, the
   calendar entries those dishes created. The commitment and the booking are
   one thing, so they leave together. */
async function dropMealCookbook(env, mealId, cookbookId) {
  const dishes = (await env.DB.prepare(
    "SELECT dish_id, entry_id FROM meal_dishes WHERE meal_id = ? AND cookbook_id = ?"
  ).bind(mealId, cookbookId).all()).results || [];
  const entries = dishes.map(d => d.entry_id).filter(Boolean);
  if (entries.length) {
    await env.DB.prepare(
      "DELETE FROM schedule_entries WHERE entry_id IN (" + placeholders(entries.length) + ")"
    ).bind(...entries).run();
  }
  await env.DB.prepare(
    "DELETE FROM meal_dishes WHERE meal_id = ? AND cookbook_id = ?"
  ).bind(mealId, cookbookId).run();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SCHEDULE_ENTRIES = 2000;
const MAX_GROCERY_LISTS = 200;
const MAX_GROCERY_ITEMS = 400;
const MAX_GROCERY_SEGMENTS = 8;
const MAX_MEALS = 300;
const MAX_MEAL_GUESTS = 40;
const MAX_MEAL_DISHES = 60;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MEAL_STATUSES = ["owner", "invited", "accepted", "declined"];

/* Can this cookbook read this recipe at all? Its own, one a linked cookbook
   shares with friends, or one handed to it individually. This is the same
   test the library query makes, written the other way round for one recipe -
   pinIsAllowed cannot stand in because it deliberately says no to a recipe
   you already own, and scheduling your own dinner is the common case. */
async function canSeeRecipe(env, cookbookId, recipeId) {
  const row = await env.DB.prepare(
    "SELECT cookbook_id, visibility FROM recipes WHERE recipe_id = ?"
  ).bind(recipeId).first();
  if (!row) return false;
  if (row.cookbook_id === cookbookId) return true;
  return reachesReader(env, cookbookId, row, recipeId);
}

/* A shopping list comes in already added up, so this checks the shape rather
   than the sums: known fields only, sane lengths, numbers that are numbers.
   Anything unrecognised is dropped instead of stored, so a future field
   cannot be smuggled into the blob and read back as trusted. */
function optNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0 || n > 1e7) return null;
  return Math.round(n * 1000) / 1000;
}
function validateGroceryItems(raw) {
  if (!Array.isArray(raw)) throw new ApiError(400, "That list was not readable.");
  if (raw.length > MAX_GROCERY_ITEMS) throw new ApiError(413, "That list is too long.");
  const out = [];
  raw.forEach(function (it, i) {
    if (!it || typeof it !== "object" || Array.isArray(it)) return;
    const name = cleanString(it.name, 200);
    if (!name) return;
    const qty = [];
    if (Array.isArray(it.qty)) {
      it.qty.slice(0, MAX_GROCERY_SEGMENTS).forEach(function (s) {
        if (!s || typeof s !== "object") return;
        qty.push({ mv: optNum(s.mv), mu: cleanString(s.mu, 24), cv: optNum(s.cv), cu: cleanString(s.cu, 24) });
      });
    }
    const from = [];
    if (Array.isArray(it.from)) {
      it.from.slice(0, 40).forEach(function (f) {
        const t = cleanString(f, 200);
        if (t) from.push(t);
      });
    }
    out.push({
      id: cleanString(it.id, 32) || ("g" + (i + 1)),
      name: name,
      checked: it.checked === true,
      removed: it.removed === true,
      from: from,
      qty: qty
    });
  });
  const text = JSON.stringify(out);
  if (text.length > MAX_RECIPE_BYTES) throw new ApiError(413, "That list is too big to store.");
  return out;
}

/* Can this cookbook read somebody else's recipe? Three ways in, checked
   cheapest first: it was handed to them individually (which is what
   "selective" means), they pinned it from a share link, or it is on the
   friends tier and the two cookbooks are linked. Private reaches none of
   these, which is the whole point of it. */
async function reachesReader(env, cookbookId, row, recipeId) {
  const handed = await env.DB.prepare(
    "SELECT recipe_id FROM recipe_shares WHERE recipe_id = ? AND cookbook_id = ?"
  ).bind(recipeId, cookbookId).first();
  if (handed) return true;
  const granted = await env.DB.prepare(
    "SELECT recipe_id FROM link_grants WHERE recipe_id = ? AND cookbook_id = ?"
  ).bind(recipeId, cookbookId).first();
  if (granted) return true;
  if (row.visibility !== "friends") return false;
  const friends = await friendCookbooks(env, cookbookId);
  return friends.indexOf(row.cookbook_id) >= 0;
}

/* A link grant is the only thing holding somebody else's recipe in this
   library, so it has to outlive everything that leans on it and go when the
   last of them does. Two things lean on it: a mark of any kind, and a day on
   the calendar. This used to be keyed to the pin alone, which was true only
   while the pin was the one thing a link could leave behind - a favourited
   recipe then sat in Everyone's recipes carrying no mark, with nothing left
   to un-toggle and so no way back out of the library.
   Owned and friend-reachable recipes are unaffected: they have no grant row,
   so the delete finds nothing. */
async function releaseGrantIfUnused(env, cookbookId, recipeId) {
  const marked = await env.DB.prepare(
    "SELECT 1 AS n FROM recipe_marks WHERE cookbook_id = ? AND recipe_id = ? LIMIT 1"
  ).bind(cookbookId, recipeId).first();
  if (marked) return false;
  const booked = await env.DB.prepare(
    "SELECT 1 AS n FROM schedule_entries WHERE cookbook_id = ? AND recipe_id = ? LIMIT 1"
  ).bind(cookbookId, recipeId).first();
  if (booked) return false;
  await env.DB.prepare(
    "DELETE FROM link_grants WHERE recipe_id = ? AND cookbook_id = ?"
  ).bind(recipeId, cookbookId).run();
  return true;
}

/* Is a recipe actually readable by this cookbook? Mirrors what recipe/mark
   allows. */
async function pinIsAllowed(env, cookbookId, recipeId) {
  const row = await env.DB.prepare(
    "SELECT cookbook_id, visibility FROM recipes WHERE recipe_id = ?"
  ).bind(recipeId).first();
  if (!row) return false;
  if (row.cookbook_id === cookbookId) return false;      /* already theirs */
  return reachesReader(env, cookbookId, row, recipeId);
}

/* Called whenever two cookbooks become linked. Any pin either of them was
   waiting on becomes real if the recipe is now visible; either way the wish
   is spent, so it does not sit around forever. */
async function resolvePendingPins(env, cbA, cbB) {
  const now = new Date().toISOString();
  const pairs = [[cbA, cbB], [cbB, cbA]];
  for (const pair of pairs) {
    const waiting = pair[0], owner = pair[1];
    const rows = (await env.DB.prepare(
      "SELECT p.recipe_id FROM pending_pins p JOIN recipes r ON r.recipe_id = p.recipe_id " +
      "WHERE p.cookbook_id = ? AND r.cookbook_id = ?"
    ).bind(waiting, owner).all()).results || [];
    for (const row of rows) {
      if (await pinIsAllowed(env, waiting, row.recipe_id)) {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO recipe_marks (cookbook_id, recipe_id, kind, created_by, created_at) " +
          "VALUES (?, ?, 'pin', ?, ?)"
        ).bind(waiting, row.recipe_id, "shared link", now).run();
        await env.DB.prepare(
          "DELETE FROM pending_pins WHERE cookbook_id = ? AND recipe_id = ?"
        ).bind(waiting, row.recipe_id).run();
      }
    }
  }
}

/* Nothing writes pending_pins any more: a share link pins on the spot rather
   than waiting on a friendship. resolvePendingPins stays because cookbooks
   upgraded from the old behaviour may still have wishes sitting in that
   table, and accepting a friend request ought to settle them. */

async function handleApi(route, body, env, request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await ensureSchema(env);

  /* ---- sign in / create ---- */
  if (route === "session") {
    const username = cleanString(body.username, 40);
    const cookbookId = cleanString(body.cookbookId, 40).toUpperCase();
    if (!USERNAME_RE.test(username)) {
      throw new ApiError(400, "Usernames are 2-20 characters: letters, numbers, dot, dash or underscore.");
    }
    if (!COOKBOOK_RE.test(cookbookId)) {
      throw new ApiError(400, "A Cookbook ID is 10 characters, letters and numbers only.");
    }
    const byName = await env.DB.prepare(
      "SELECT username, cookbook_id FROM users WHERE username_lc = ?"
    ).bind(username.toLowerCase()).first();

    if (byName) {
      if (byName.cookbook_id !== cookbookId) {
        throw new ApiError(409, "That username already belongs to a different cookbook. Check the ID, or pick another name.");
      }
      return jsonResponse({
        username: byName.username, cookbookId, created: false, joined: false,
        members: await countMembers(env, cookbookId)
      });
    }

    /* A new username with an existing Cookbook ID joins that cookbook. */
    const existing = await countMembers(env, cookbookId);
    if (existing > 0 && !body.confirmJoin) {
      const map = await membersOf(env, [cookbookId]);
      const names = map[cookbookId] || [];
      throw new ApiError(409,
        "That Cookbook ID already belongs to a cookbook with " + names.join(", ") +
        " in it. Joining means you can read and edit everything in it, and you will be linked to everyone it is already friends with.",
        "CONFIRM_JOIN");
    }

    await env.DB.prepare(
      "INSERT INTO users (username_lc, username, cookbook_id, created_at) VALUES (?, ?, ?, ?)"
    ).bind(username.toLowerCase(), username, cookbookId, new Date().toISOString()).run();
    return jsonResponse({
      username, cookbookId, created: existing === 0, joined: existing > 0, members: existing + 1
    });
  }

  /* ---- a shared link, opened by anybody ----
     The only route that answers without a session. A share link is a
     capability: recipe ids are 14 characters of [a-z0-9], so holding one is
     evidence somebody handed it over. Private recipes are refused outright -
     they generate no link in the first place, so a link to one is either
     stale or guessed. Ratings and comments are deliberately not included;
     those stay between linked cookbooks. */
  if (route === "recipe/public") {
    await throttleGuard(env, ["ip:" + ip]);
    const recipeId = cleanString(body.recipeId, 64);
    const row = await env.DB.prepare(
      "SELECT recipe_id, cookbook_id, owner_username, visibility, data FROM recipes WHERE recipe_id = ?"
    ).bind(recipeId).first();
    if (!row) throw new ApiError(404, "That link points at a recipe that is no longer there.");
    if (!isShareable(row.visibility)) {
      throw new ApiError(403, "The owner has not shared this recipe.");
    }
    let data = null;
    try { data = JSON.parse(row.data); } catch (e) { throw new ApiError(500, "That recipe could not be read."); }
    const map = await membersOf(env, [row.cookbook_id]);
    return jsonResponse({
      recipeId: row.recipe_id,
      owner: row.owner_username,
      household: householdLabel(map[row.cookbook_id] || [row.owner_username]),
      visibility: row.visibility,
      data
    });
  }

  const me = await requireAuth(env, body);

  /* ---- everything visible to me ---- */
  if (route === "library") {
    const friendCbs = await friendCookbooks(env, me.cookbookId);

    const pendingIn = (await env.DB.prepare(
      "SELECT requester_cb, requested_by, created_at FROM friendships " +
      "WHERE addressee_cb = ? AND status = 'pending' ORDER BY created_at"
    ).bind(me.cookbookId).all()).results || [];
    const pendingOut = (await env.DB.prepare(
      "SELECT addressee_cb, created_at FROM friendships " +
      "WHERE requester_cb = ? AND status = 'pending' ORDER BY created_at"
    ).bind(me.cookbookId).all()).results || [];
    const declinedRows = (await env.DB.prepare(
      "SELECT requester_cb, requested_by FROM friendships " +
      "WHERE addressee_cb = ? AND status = 'declined'"
    ).bind(me.cookbookId).all()).results || [];

    /* Guest cookbooks on a shared meal need names too, and they are not
       necessarily friends of ours, so they are folded into the same lookup
       rather than fetched separately. */
    const mealRaw = await mealsFor(env, me.cookbookId);

    const memberMap = await membersOf(env, [me.cookbookId].concat(
      friendCbs,
      pendingIn.map(r => r.requester_cb),
      pendingOut.map(r => r.addressee_cb),
      declinedRows.map(r => r.requester_cb),
      mealRaw.cookbooks
    ));

    const labelFor = {};
    labelFor[me.cookbookId] = householdLabel(memberMap[me.cookbookId] || [me.username]);
    for (const cb of friendCbs) labelFor[cb] = householdLabel(memberMap[cb] || []);
    /* Recipes are only ever labelled from labelFor, which is friends-only on
       purpose. Meals need a wider one, so they get their own reader. */
    const mealLabel = (cb) => labelFor[cb] || householdLabel(memberMap[cb] || []) || "Someone";

    let sql = "SELECT recipe_id, cookbook_id, owner_username, visibility, data, created_at, updated_at, updated_by " +
      "FROM recipes WHERE cookbook_id = ?";
    const binds = [me.cookbookId];
    if (friendCbs.length) {
      sql += " OR (visibility = 'friends' AND cookbook_id IN (" + placeholders(friendCbs.length) + "))";
      binds.push(...friendCbs);
    }
    /* A recipe handed to this cookbook specifically - which is what the
       selective tier is - or one they pinned from a share link. */
    sql += " OR recipe_id IN (SELECT recipe_id FROM recipe_shares WHERE cookbook_id = ?)";
    binds.push(me.cookbookId);
    sql += " OR recipe_id IN (SELECT recipe_id FROM link_grants WHERE cookbook_id = ?)";
    binds.push(me.cookbookId);
    const recipeRows = (await env.DB.prepare(sql).bind(...binds).all()).results || [];

    const recipes = recipeRows.map(row => {
      let data = null;
      try { data = JSON.parse(row.data); } catch (e) { data = { title: "Unreadable recipe" }; }
      return {
        recipeId: row.recipe_id,
        owner: row.owner_username,
        household: labelFor[row.cookbook_id] || row.owner_username,
        ours: row.cookbook_id === me.cookbookId,
        visibility: row.visibility,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by || row.owner_username,
        data
      };
    });

    /* Comments are visible between linked cookbooks, so a new member of a
       cookbook can see everything that cookbook could already see. */
    const voices = [me.cookbookId].concat(friendCbs);
    const csql = "SELECT c.comment_id, c.recipe_id, c.username, c.rating, c.comment, c.cooked_on, c.created_at " +
      "FROM comments c JOIN recipes r ON r.recipe_id = c.recipe_id " +
      "JOIN users u ON u.username_lc = c.username_lc " +
      "WHERE (r.cookbook_id = ?" +
      (friendCbs.length ? " OR (r.visibility = 'friends' AND r.cookbook_id IN (" + placeholders(friendCbs.length) + "))" : "") +
      ") AND u.cookbook_id IN (" + placeholders(voices.length) + ") ORDER BY c.cooked_on DESC";
    const cbinds = [me.cookbookId].concat(friendCbs, voices);
    const commentRows = (await env.DB.prepare(csql).bind(...cbinds).all()).results || [];
    const comments = {};
    for (const c of commentRows) {
      (comments[c.recipe_id] = comments[c.recipe_id] || []).push({
        commentId: c.comment_id, username: c.username, rating: c.rating,
        comment: c.comment, cookedOn: c.cooked_on, createdAt: c.created_at
      });
    }

    /* Marks belong to the cookbook, not the person: a household stars once. */
    const markRows = (await env.DB.prepare(
      "SELECT recipe_id, kind FROM recipe_marks WHERE cookbook_id = ?"
    ).bind(me.cookbookId).all()).results || [];
    const marks = { pin: [], star: [], later: [] };
    for (const m of markRows) if (marks[m.kind]) marks[m.kind].push(m.recipe_id);

    /* Who our own private recipes have been handed to. */
    const shareRows = (await env.DB.prepare(
      "SELECT s.recipe_id, s.cookbook_id FROM recipe_shares s " +
      "JOIN recipes r ON r.recipe_id = s.recipe_id WHERE r.cookbook_id = ?"
    ).bind(me.cookbookId).all()).results || [];
    const shares = {};
    for (const row of shareRows) {
      const label = labelFor[row.cookbook_id];
      if (label) (shares[row.recipe_id] = shares[row.recipe_id] || []).push(label);
    }

    /* The whole calendar, and the shelf of shopping lists without their
       contents. A plan is a few dozen rows at most, so it rides along; a
       list's items are fetched when the list is opened, which keeps a year
       of shopping out of every sync. */
    const schedRows = (await env.DB.prepare(
      "SELECT entry_id, recipe_id, title, on_date, servings, created_by, created_at " +
      "FROM schedule_entries WHERE cookbook_id = ? ORDER BY on_date, created_at"
    ).bind(me.cookbookId).all()).results || [];
    const schedule = schedRows.map(row => ({
      entryId: row.entry_id, recipeId: row.recipe_id, title: row.title,
      date: row.on_date, servings: row.servings, by: row.created_by, createdAt: row.created_at
    }));

    const listRows = (await env.DB.prepare(
      "SELECT list_id, label, start_date, end_date, item_count, created_by, created_at, updated_at " +
      "FROM grocery_lists WHERE cookbook_id = ? ORDER BY created_at DESC"
    ).bind(me.cookbookId).all()).results || [];
    const groceryLists = listRows.map(row => ({
      listId: row.list_id, label: row.label, startDate: row.start_date, endDate: row.end_date,
      itemCount: row.item_count, by: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at
    }));

    const prefRow = await env.DB.prepare(
      "SELECT exclusions FROM cookbook_prefs WHERE cookbook_id = ?"
    ).bind(me.cookbookId).first();
    let exclusions = DEFAULT_EXCLUSIONS.slice();
    if (prefRow) {
      try {
        const parsed = JSON.parse(prefRow.exclusions);
        if (Array.isArray(parsed)) exclusions = parsed.map(x => String(x));
      } catch (e) { /* a corrupt blob falls back to the defaults */ }
    }

    const mates = (memberMap[me.cookbookId] || []).filter(n => n.toLowerCase() !== me.usernameLc);
    /* When each link was made. The app folds everything a friend had already
       shared before that moment into a single piece of news. */
    const sinceRows = (await env.DB.prepare(
      "SELECT CASE WHEN requester_cb = ? THEN addressee_cb ELSE requester_cb END AS cb, updated_at " +
      "FROM friendships WHERE status = 'accepted' AND (requester_cb = ? OR addressee_cb = ?)"
    ).bind(me.cookbookId, me.cookbookId, me.cookbookId).all()).results || [];
    const sinceFor = {};
    for (const row of sinceRows) sinceFor[row.cb] = row.updated_at;

    const friends = friendCbs
      .map(cb => ({ label: labelFor[cb], members: memberMap[cb] || [], since: sinceFor[cb] || null }))
      .filter(f => f.label)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

    return jsonResponse({
      me: { username: me.username, cookbookId: me.cookbookId, household: labelFor[me.cookbookId] },
      recipes,
      comments,
      marks,
      shares,
      schedule,
      meals: shapeMeals(mealRaw.meals, mealLabel, me.cookbookId),
      groceryLists,
      exclusions,
      mates,
      friends,
      incoming: pendingIn.map(r => ({
        by: r.requested_by,
        members: memberMap[r.requester_cb] || [r.requested_by],
        label: householdLabel(memberMap[r.requester_cb] || [r.requested_by]),
        createdAt: r.created_at
      })),
      outgoing: pendingOut.map(r => ({
        members: memberMap[r.addressee_cb] || [],
        label: householdLabel(memberMap[r.addressee_cb] || []),
        createdAt: r.created_at
      })),
      declined: declinedRows.map(r => ({
        by: r.requested_by,
        members: memberMap[r.requester_cb] || [r.requested_by],
        label: householdLabel(memberMap[r.requester_cb] || [r.requested_by])
      }))
    });
  }

  /* ---- star / save for later / pin ----
     A pin is a live view of somebody else's recipe, not a copy: nothing is
     duplicated, so their edits show and their deletion takes it away. */
  if (route === "recipe/mark") {
    const recipeId = cleanString(body.recipeId, 64);
    const kind = cleanString(body.kind, 12);
    if (MARK_KINDS.indexOf(kind) < 0) throw new ApiError(400, "Unknown mark.");
    const visible = await env.DB.prepare(
      "SELECT cookbook_id, visibility FROM recipes WHERE recipe_id = ?"
    ).bind(recipeId).first();
    if (!visible) throw new ApiError(404, "That recipe is gone.");
    const mine = visible.cookbook_id === me.cookbookId;
    if (!mine && !(await reachesReader(env, me.cookbookId, visible, recipeId))) {
      throw new ApiError(403, "That recipe is not yours to mark.");
    }
    if (kind === "pin" && mine) throw new ApiError(400, "That one is already in your cookbook.");

    if (body.on === false) {
      await env.DB.prepare(
        "DELETE FROM recipe_marks WHERE cookbook_id = ? AND recipe_id = ? AND kind = ?"
      ).bind(me.cookbookId, recipeId, kind).run();
      /* A recipe reached by link is in this library only because some mark
         or booking put it there. Taking the last of those off takes the
         grant with it, otherwise it would sit there unmarked and
         unremovable. */
      await releaseGrantIfUnused(env, me.cookbookId, recipeId);
    } else {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO recipe_marks (cookbook_id, recipe_id, kind, created_by, created_at) " +
        "VALUES (?, ?, ?, ?, ?)"
      ).bind(me.cookbookId, recipeId, kind, me.username, new Date().toISOString()).run();
    }
    return jsonResponse({ recipeId, kind, on: body.on !== false });
  }

  /* ---- put a recipe on the calendar ----
     Anything the cookbook can currently see can be scheduled, including a
     friend's. The title is copied in at the same time so the square survives
     the recipe being deleted or unshared later. */
  if (route === "schedule/add") {
    const recipeId = cleanString(body.recipeId, 64);
    const date = cleanString(body.date, 10);
    if (!DATE_RE.test(date)) throw new ApiError(400, "That is not a day.");
    const servings = Number(body.servings);
    if (!(servings > 0) || servings > 999) throw new ApiError(400, "Servings has to be a number above zero.");
    if (!(await canSeeRecipe(env, me.cookbookId, recipeId))) {
      throw new ApiError(404, "That recipe is not in your box.");
    }
    const row = await env.DB.prepare("SELECT title FROM recipes WHERE recipe_id = ?").bind(recipeId).first();
    const title = cleanString(row && row.title, 200) || cleanString(body.title, 200) || "Untitled recipe";
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM schedule_entries WHERE cookbook_id = ?"
    ).bind(me.cookbookId).first();
    if (count && count.n >= MAX_SCHEDULE_ENTRIES) {
      throw new ApiError(409, "That is as much as the calendar will hold. Clear some older days first.");
    }
    const entryId = newEntryId();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO schedule_entries (entry_id, cookbook_id, recipe_id, title, on_date, servings, created_by, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(entryId, me.cookbookId, recipeId, title, date, servings, me.username, now).run();
    return jsonResponse({
      entry: { entryId, recipeId, title, date, servings, by: me.username, createdAt: now }
    });
  }

  /* Move a booking, or change how many it is feeding. The recipe it points at
     is fixed - swapping that would be a different dinner, not an edit. */
  if (route === "schedule/update") {
    const entryId = cleanString(body.entryId, 64);
    const date = cleanString(body.date, 10);
    if (!DATE_RE.test(date)) throw new ApiError(400, "That is not a day.");
    const servings = Number(body.servings);
    if (!(servings > 0) || servings > 999) throw new ApiError(400, "Servings has to be a number above zero.");
    const row = await env.DB.prepare(
      "SELECT entry_id FROM schedule_entries WHERE entry_id = ? AND cookbook_id = ?"
    ).bind(entryId, me.cookbookId).first();
    if (!row) throw new ApiError(404, "That booking is gone.");
    /* A dish you are bringing to a community meal is pinned to the meal's
       day. The servings are yours to change; the day belongs to the host.
       The client hides the field, and this is the same rule stated where it
       cannot be got round. */
    const dish = await env.DB.prepare(
      "SELECT d.dish_id, m.on_date FROM meal_dishes d " +
      "JOIN community_meals m ON m.meal_id = d.meal_id WHERE d.entry_id = ?"
    ).bind(entryId).first();
    const onDate = dish ? dish.on_date : date;
    await env.DB.prepare(
      "UPDATE schedule_entries SET on_date = ?, servings = ? WHERE entry_id = ? AND cookbook_id = ?"
    ).bind(onDate, servings, entryId, me.cookbookId).run();
    return jsonResponse({ entryId, date: onDate, servings, meal: !!dish });
  }

  if (route === "schedule/remove") {
    const entryId = cleanString(body.entryId, 64);
    /* Read before deleting: once the row is gone there is nothing left to
       say which recipe the booking was holding open. */
    const held = await env.DB.prepare(
      "SELECT recipe_id FROM schedule_entries WHERE entry_id = ? AND cookbook_id = ?"
    ).bind(entryId, me.cookbookId).first();
    await env.DB.prepare(
      "DELETE FROM schedule_entries WHERE entry_id = ? AND cookbook_id = ?"
    ).bind(entryId, me.cookbookId).run();
    if (held && held.recipe_id) {
      await releaseGrantIfUnused(env, me.cookbookId, held.recipe_id);
    }
    /* Unscheduling a community-meal dish from your own calendar is the same
       act as taking it off the tile - there is one commitment, reachable
       from two places, and it cannot survive in half. */
    const dish = await env.DB.prepare(
      "SELECT dish_id FROM meal_dishes WHERE entry_id = ? AND cookbook_id = ?"
    ).bind(entryId, me.cookbookId).first();
    if (dish) {
      await env.DB.prepare("DELETE FROM meal_dishes WHERE dish_id = ?").bind(dish.dish_id).run();
    }
    return jsonResponse({ entryId, removed: true, meal: !!dish });
  }

  /* ---- community meals ----
     A meal is owned by a cookbook and seen by its guests. Every route below
     re-reads the seat rather than trusting the client about it, because the
     guest list is the whole of the permission model here. */

  /* Invite by username, resolved to that person's cookbook and checked
     against the friend list - the same shape as sending a friend request, so
     you can only ever put a meal in front of somebody already linked to you. */
  async function resolveGuestCookbooks(names, meCb) {
    const friendCbs = await friendCookbooks(env, meCb);
    const allowed = new Set(friendCbs);
    const out = [];
    for (const raw of (Array.isArray(names) ? names : [])) {
      const name = cleanString(raw, 40);
      if (!name) continue;
      const row = await env.DB.prepare(
        "SELECT cookbook_id FROM users WHERE username_lc = ?"
      ).bind(name.toLowerCase()).first();
      if (!row) throw new ApiError(404, "There is nobody here called " + name + ".");
      if (row.cookbook_id === meCb) continue;              /* already the host */
      if (!allowed.has(row.cookbook_id)) {
        throw new ApiError(403, "You can only invite people you are friends with.");
      }
      if (out.indexOf(row.cookbook_id) < 0) out.push(row.cookbook_id);
    }
    return out;
  }

  if (route === "meal/create") {
    const title = cleanString(body.title, 120) || "Community Meal";
    const date = cleanString(body.date, 10);
    const time = cleanString(body.time, 5);
    /* Both optional, so an empty one is stored as an empty string rather than
       being rejected. Lengths are generous enough for a sentence and an
       address and no more. */
    const description = cleanString(body.description, 500);
    const location = cleanString(body.location, 200);
    if (!DATE_RE.test(date)) throw new ApiError(400, "That is not a day.");
    if (time && !TIME_RE.test(time)) throw new ApiError(400, "That is not a time.");
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM community_meals WHERE owner_cb = ?"
    ).bind(me.cookbookId).first();
    if (count && count.n >= MAX_MEALS) {
      throw new ApiError(409, "That is as many meals as one cookbook can host. Clear some older ones first.");
    }
    const guests = await resolveGuestCookbooks(body.guests, me.cookbookId);
    if (guests.length > MAX_MEAL_GUESTS) {
      throw new ApiError(409, "That is more guests than one meal will hold.");
    }
    const mealId = newMealId();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO community_meals (meal_id, owner_cb, title, on_date, at_time, description, location, " +
      "created_by, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(mealId, me.cookbookId, title, date, time, description, location, me.username, now, now).run();
    await env.DB.prepare(
      "INSERT INTO meal_guests (meal_id, cookbook_id, status, invited_by, responded_by, updated_at) " +
      "VALUES (?, ?, 'owner', ?, ?, ?)"
    ).bind(mealId, me.cookbookId, me.username, me.username, now).run();
    for (const cb of guests) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO meal_guests (meal_id, cookbook_id, status, invited_by, responded_by, updated_at) " +
        "VALUES (?, ?, 'invited', ?, NULL, ?)"
      ).bind(mealId, cb, me.username, now).run();
    }
    return jsonResponse({ mealId });
  }

  /* Title, day and time. Moving the day drags every guest's linked calendar
     entry with it: the booking exists because of the meal, so it goes where
     the meal goes rather than being left behind on a Tuesday nobody is
     cooking any more. */
  if (route === "meal/update") {
    const mealId = cleanString(body.mealId, 64);
    const seat = await mealSeat(env, mealId, me.cookbookId);
    if (!seat.isOwner) throw new ApiError(403, "Only the cookbook hosting it can change a meal.");
    const title = cleanString(body.title, 120) || seat.meal.title || "Community Meal";
    const date = cleanString(body.date, 10);
    const time = cleanString(body.time, 5);
    const description = cleanString(body.description, 500);
    const location = cleanString(body.location, 200);
    if (!DATE_RE.test(date)) throw new ApiError(400, "That is not a day.");
    if (time && !TIME_RE.test(time)) throw new ApiError(400, "That is not a time.");
    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE community_meals SET title = ?, on_date = ?, at_time = ?, description = ?, " +
      "location = ?, updated_at = ? WHERE meal_id = ?"
    ).bind(title, date, time, description, location, now, mealId).run();
    if (date !== seat.meal.on_date) {
      const entries = ((await env.DB.prepare(
        "SELECT entry_id FROM meal_dishes WHERE meal_id = ? AND entry_id IS NOT NULL"
      ).bind(mealId).all()).results || []).map(r => r.entry_id);
      if (entries.length) {
        await env.DB.prepare(
          "UPDATE schedule_entries SET on_date = ? WHERE entry_id IN (" +
          placeholders(entries.length) + ")"
        ).bind(date, ...entries).run();
      }
    }
    return jsonResponse({ mealId, title, date, time, description, location });
  }

  if (route === "meal/invite") {
    const mealId = cleanString(body.mealId, 64);
    const seat = await mealSeat(env, mealId, me.cookbookId);
    if (!seat.isOwner) throw new ApiError(403, "Only the cookbook hosting it can invite people.");
    const guests = await resolveGuestCookbooks(body.guests, me.cookbookId);
    const have = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM meal_guests WHERE meal_id = ?"
    ).bind(mealId).first();
    if ((have ? have.n : 0) + guests.length > MAX_MEAL_GUESTS + 1) {
      throw new ApiError(409, "That is more guests than one meal will hold.");
    }
    const now = new Date().toISOString();
    for (const cb of guests) {
      /* Somebody who said no once can be asked again - the invitation is
         reopened rather than duplicated. */
      await env.DB.prepare(
        "INSERT INTO meal_guests (meal_id, cookbook_id, status, invited_by, responded_by, updated_at) " +
        "VALUES (?, ?, 'invited', ?, NULL, ?) " +
        "ON CONFLICT(meal_id, cookbook_id) DO UPDATE SET " +
        "status = CASE WHEN meal_guests.status = 'declined' THEN 'invited' ELSE meal_guests.status END, " +
        "updated_at = excluded.updated_at"
      ).bind(mealId, cb, me.username, now).run();
    }
    return jsonResponse({ mealId, invited: guests.length });
  }

  /* Withdrawing an invitation, which is only a thing you can do to somebody
     who has not answered yet. Once they have accepted they are a guest, and
     a guest leaves under their own steam. */
  if (route === "meal/uninvite") {
    const mealId = cleanString(body.mealId, 64);
    const guest = cleanString(body.guest, 40);
    const seat = await mealSeat(env, mealId, me.cookbookId);
    if (!seat.isOwner) throw new ApiError(403, "Only the cookbook hosting it can un-invite people.");
    const row = await env.DB.prepare(
      "SELECT cookbook_id FROM users WHERE username_lc = ?"
    ).bind(guest.toLowerCase()).first();
    if (!row) throw new ApiError(404, "There is nobody here called " + guest + ".");
    if (row.cookbook_id === me.cookbookId) throw new ApiError(400, "You are hosting it.");
    const g = await env.DB.prepare(
      "SELECT status FROM meal_guests WHERE meal_id = ? AND cookbook_id = ?"
    ).bind(mealId, row.cookbook_id).first();
    if (!g) throw new ApiError(404, "They are not on that meal.");
    if (g.status === "accepted") {
      throw new ApiError(409, "They have already accepted. Only they can take themselves off it now.");
    }
    await env.DB.prepare(
      "DELETE FROM meal_guests WHERE meal_id = ? AND cookbook_id = ?"
    ).bind(mealId, row.cookbook_id).run();
    return jsonResponse({ mealId, removed: true });
  }

  if (route === "meal/respond") {
    const mealId = cleanString(body.mealId, 64);
    const answer = cleanString(body.answer, 12);
    if (answer !== "accept" && answer !== "decline") throw new ApiError(400, "Accept or decline.");
    const seat = await mealSeat(env, mealId, me.cookbookId);
    if (seat.isOwner) throw new ApiError(400, "You are hosting it.");
    const now = new Date().toISOString();
    if (answer === "decline") await dropMealCookbook(env, mealId, me.cookbookId);
    await env.DB.prepare(
      "UPDATE meal_guests SET status = ?, responded_by = ?, updated_at = ? " +
      "WHERE meal_id = ? AND cookbook_id = ?"
    ).bind(answer === "accept" ? "accepted" : "declined", me.username, now, mealId, me.cookbookId).run();
    return jsonResponse({ mealId, status: answer === "accept" ? "accepted" : "declined" });
  }

  if (route === "meal/leave") {
    const mealId = cleanString(body.mealId, 64);
    const seat = await mealSeat(env, mealId, me.cookbookId);
    if (seat.isOwner) throw new ApiError(400, "You are hosting it — cancel it instead.");
    await dropMealCookbook(env, mealId, me.cookbookId);
    await env.DB.prepare(
      "DELETE FROM meal_guests WHERE meal_id = ? AND cookbook_id = ?"
    ).bind(mealId, me.cookbookId).run();
    return jsonResponse({ mealId, left: true });
  }

  /* Calling the whole thing off. Every guest's linked calendar entry goes
     with it, theirs as well as ours. */
  if (route === "meal/cancel") {
    const mealId = cleanString(body.mealId, 64);
    const seat = await mealSeat(env, mealId, me.cookbookId);
    if (!seat.isOwner) throw new ApiError(403, "Only the cookbook hosting it can cancel a meal.");
    const entries = ((await env.DB.prepare(
      "SELECT entry_id FROM meal_dishes WHERE meal_id = ? AND entry_id IS NOT NULL"
    ).bind(mealId).all()).results || []).map(r => r.entry_id);
    if (entries.length) {
      await env.DB.prepare(
        "DELETE FROM schedule_entries WHERE entry_id IN (" + placeholders(entries.length) + ")"
      ).bind(...entries).run();
    }
    await env.DB.prepare("DELETE FROM meal_dishes WHERE meal_id = ?").bind(mealId).run();
    await env.DB.prepare("DELETE FROM meal_guests WHERE meal_id = ?").bind(mealId).run();
    await env.DB.prepare("DELETE FROM community_meals WHERE meal_id = ?").bind(mealId).run();
    return jsonResponse({ mealId, cancelled: true });
  }

  /* Signing up to bring something. Two rows in one breath: the dish everyone
     can see, and the calendar entry only this cookbook can, carrying the
     servings that will reach the shopping list. The servings live on the
     entry alone - nobody at the table needs to know you are making enough
     for twelve. */
  if (route === "meal/dish/add") {
    const mealId = cleanString(body.mealId, 64);
    const recipeId = cleanString(body.recipeId, 64);
    const servings = Number(body.servings);
    const seat = await mealSeat(env, mealId, me.cookbookId);
    if (seat.status === "invited") throw new ApiError(409, "Accept the invitation first.");
    if (!(servings > 0) || servings > 999) throw new ApiError(400, "Servings has to be a number above zero.");
    if (!(await canSeeRecipe(env, me.cookbookId, recipeId))) {
      throw new ApiError(404, "That recipe is not in your box.");
    }
    const have = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM meal_dishes WHERE meal_id = ?"
    ).bind(mealId).first();
    if (have && have.n >= MAX_MEAL_DISHES) {
      throw new ApiError(409, "That is as many dishes as one meal will hold.");
    }
    const row = await env.DB.prepare("SELECT title FROM recipes WHERE recipe_id = ?").bind(recipeId).first();
    const title = cleanString(row && row.title, 200) || cleanString(body.title, 200) || "Untitled recipe";
    const now = new Date().toISOString();
    const entryId = newEntryId();
    await env.DB.prepare(
      "INSERT INTO schedule_entries (entry_id, cookbook_id, recipe_id, title, on_date, servings, created_by, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(entryId, me.cookbookId, recipeId, title, seat.meal.on_date, servings, me.username, now).run();
    const dishId = newDishId();
    await env.DB.prepare(
      "INSERT INTO meal_dishes (dish_id, meal_id, cookbook_id, recipe_id, title, entry_id, created_by, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(dishId, mealId, me.cookbookId, recipeId, title, entryId, me.username, now).run();
    return jsonResponse({ dishId, mealId, entryId, title, servings });
  }

  /* Taking a dish back off, from either end: the tile or the calendar. Both
     halves go, because they were one commitment. */
  if (route === "meal/dish/remove") {
    const mealId = cleanString(body.mealId, 64);
    const dishId = cleanString(body.dishId, 64);
    await mealSeat(env, mealId, me.cookbookId);
    const dish = await env.DB.prepare(
      "SELECT entry_id, cookbook_id FROM meal_dishes WHERE dish_id = ? AND meal_id = ?"
    ).bind(dishId, mealId).first();
    if (!dish) return jsonResponse({ dishId, removed: true });
    if (dish.cookbook_id !== me.cookbookId) {
      throw new ApiError(403, "That is somebody else's dish.");
    }
    if (dish.entry_id) {
      await env.DB.prepare(
        "DELETE FROM schedule_entries WHERE entry_id = ? AND cookbook_id = ?"
      ).bind(dish.entry_id, me.cookbookId).run();
    }
    await env.DB.prepare("DELETE FROM meal_dishes WHERE dish_id = ?").bind(dishId).run();
    return jsonResponse({ dishId, removed: true });
  }

  /* ---- shopping lists ----
     The list arrives already added up: the client knows the scheduled
     portions and the unit rules, and doing the arithmetic twice in two
     languages would only be two places for it to disagree. The server's job
     is to check the shape, cap the size and keep it. */
  if (route === "grocery/exclusions") {
    const raw = Array.isArray(body.exclusions) ? body.exclusions : [];
    const clean = [], seen = {};
    raw.forEach(function (x) {
      const t = cleanString(x, 60).trim();
      const k = t.toLowerCase();
      if (!t || seen[k] || clean.length >= MAX_EXCLUSIONS) return;
      seen[k] = 1;
      clean.push(t);
    });
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO cookbook_prefs (cookbook_id, exclusions, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(cookbook_id) DO UPDATE SET exclusions = excluded.exclusions, updated_at = excluded.updated_at"
    ).bind(me.cookbookId, JSON.stringify(clean), now).run();
    return jsonResponse({ exclusions: clean });
  }

  if (route === "grocery/create") {
    const startDate = cleanString(body.startDate, 10);
    const endDate = cleanString(body.endDate, 10);
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) throw new ApiError(400, "Those are not days.");
    if (startDate > endDate) throw new ApiError(400, "The last day is before the first one.");
    const label = cleanString(body.label, 120) || (startDate + " - " + endDate);
    const items = validateGroceryItems(body.items);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM grocery_lists WHERE cookbook_id = ?"
    ).bind(me.cookbookId).first();
    if (count && count.n >= MAX_GROCERY_LISTS) {
      throw new ApiError(409, "That is as many lists as the shelf will hold. Delete an old one first.");
    }
    const listId = newListId();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO grocery_lists (list_id, cookbook_id, label, start_date, end_date, items, item_count, created_by, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(listId, me.cookbookId, label, startDate, endDate, JSON.stringify(items),
      items.length, me.username, now, now).run();
    return jsonResponse({
      list: { listId, label, startDate, endDate, itemCount: items.length,
        by: me.username, createdAt: now, updatedAt: now }
    });
  }

  if (route === "grocery/get") {
    const listId = cleanString(body.listId, 64);
    const row = await env.DB.prepare(
      "SELECT items FROM grocery_lists WHERE list_id = ? AND cookbook_id = ?"
    ).bind(listId, me.cookbookId).first();
    if (!row) throw new ApiError(404, "That list is gone.");
    let items = [];
    try { items = JSON.parse(row.items); } catch (e) { items = []; }
    return jsonResponse({ listId, items: Array.isArray(items) ? items : [] });
  }

  /* Every edit rewrites the whole snapshot. Last write wins, which for two
     phones in one kitchen is the behaviour you want anyway: the list is
     whatever the person holding it last said it was. */
  if (route === "grocery/save") {
    const listId = cleanString(body.listId, 64);
    const row = await env.DB.prepare(
      "SELECT list_id FROM grocery_lists WHERE list_id = ? AND cookbook_id = ?"
    ).bind(listId, me.cookbookId).first();
    if (!row) throw new ApiError(404, "That list is gone.");
    const items = validateGroceryItems(body.items);
    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE grocery_lists SET items = ?, item_count = ?, updated_at = ? WHERE list_id = ? AND cookbook_id = ?"
    ).bind(JSON.stringify(items), items.length, now, listId, me.cookbookId).run();
    return jsonResponse({ listId, itemCount: items.length, updatedAt: now });
  }

  if (route === "grocery/rename") {
    const listId = cleanString(body.listId, 64);
    const label = cleanString(body.label, 120);
    if (!label) throw new ApiError(400, "A list needs a name.");
    const row = await env.DB.prepare(
      "SELECT list_id FROM grocery_lists WHERE list_id = ? AND cookbook_id = ?"
    ).bind(listId, me.cookbookId).first();
    if (!row) throw new ApiError(404, "That list is gone.");
    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE grocery_lists SET label = ?, updated_at = ? WHERE list_id = ? AND cookbook_id = ?"
    ).bind(label, now, listId, me.cookbookId).run();
    return jsonResponse({ listId, label, updatedAt: now });
  }

  if (route === "grocery/delete") {
    const listId = cleanString(body.listId, 64);
    await env.DB.prepare(
      "DELETE FROM grocery_lists WHERE list_id = ? AND cookbook_id = ?"
    ).bind(listId, me.cookbookId).run();
    return jsonResponse({ listId, deleted: true });
  }

  /* ---- hand a private recipe to particular friends ----
     Targets are cookbooks, so a recipe shared with one half of a household
     is shared with the household. Replaces the whole list each time. */
  if (route === "recipe/share") {
    const recipeId = cleanString(body.recipeId, 64);
    const owned = await env.DB.prepare(
      "SELECT recipe_id FROM recipes WHERE recipe_id = ? AND cookbook_id = ?"
    ).bind(recipeId, me.cookbookId).first();
    if (!owned) throw new ApiError(403, "You can only share a recipe from your own cookbook.");

    const friendCbs = await friendCookbooks(env, me.cookbookId);
    const wanted = [];
    for (const raw of (Array.isArray(body.usernames) ? body.usernames : [])) {
      const name = cleanString(raw, 40).toLowerCase();
      if (!name) continue;
      const row = await env.DB.prepare("SELECT cookbook_id FROM users WHERE username_lc = ?")
        .bind(name).first();
      if (row && friendCbs.indexOf(row.cookbook_id) >= 0 && wanted.indexOf(row.cookbook_id) < 0) {
        wanted.push(row.cookbook_id);
      }
    }
    await env.DB.prepare("DELETE FROM recipe_shares WHERE recipe_id = ?").bind(recipeId).run();
    const now = new Date().toISOString();
    for (const cb of wanted) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO recipe_shares (recipe_id, cookbook_id, created_at) VALUES (?, ?, ?)"
      ).bind(recipeId, cb, now).run();
    }
    return jsonResponse({ recipeId, sharedWith: wanted.length });
  }

  /* ---- change display name ----
     The username is the key everything else points at, so a rename has to
     travel through every table that stores it. Cookbook membership, and so
     every recipe and friendship, is untouched. */
  if (route === "rename") {
    const next = cleanString(body.newUsername, 40);
    if (!USERNAME_RE.test(next)) {
      throw new ApiError(400, "Names are 2-20 characters: letters, numbers, dot, dash or underscore.");
    }
    const nextLc = next.toLowerCase();
    const oldLc = me.usernameLc;
    const oldName = me.username;
    if (nextLc !== oldLc) {
      const taken = await env.DB.prepare("SELECT username_lc FROM users WHERE username_lc = ?")
        .bind(nextLc).first();
      if (taken) throw new ApiError(409, "Somebody already uses that name. Pick another.");
    }
    await env.DB.prepare("UPDATE users SET username = ?, username_lc = ? WHERE username_lc = ?")
      .bind(next, nextLc, oldLc).run();
    await env.DB.prepare("UPDATE recipes SET owner_username = ?, owner_lc = ? WHERE owner_lc = ?")
      .bind(next, nextLc, oldLc).run();
    await env.DB.prepare("UPDATE recipes SET updated_by = ? WHERE updated_by = ?").bind(next, oldName).run();
    await env.DB.prepare("UPDATE recipes SET locked_by = ? WHERE locked_by = ?").bind(next, oldName).run();
    await env.DB.prepare("UPDATE comments SET username = ?, username_lc = ? WHERE username_lc = ?")
      .bind(next, nextLc, oldLc).run();
    await env.DB.prepare("UPDATE friendships SET requested_by = ? WHERE requested_by = ?")
      .bind(next, oldName).run();
    await env.DB.prepare("UPDATE friendships SET responded_by = ? WHERE responded_by = ?")
      .bind(next, oldName).run();
    return jsonResponse({ username: next });
  }

  /* ---- one-time tag migration ----
     Rewrites every recipe in every cookbook into the taxonomy above. Guarded
     by a token you set as a Worker variable, and a dry run by default so the
     report can be read before anything is written. */
  if (route === "admin/retag") {
    const token = cleanString(body.token, 200);
    if (!env.ADMIN_TOKEN || !token || token !== env.ADMIN_TOKEN) {
      throw new ApiError(403, "That is not the admin token.");
    }
    const apply = body.apply === true;
    const rows = (await env.DB.prepare(
      "SELECT recipe_id, cookbook_id, title, data FROM recipes"
    ).all()).results || [];
    const dropped = {}, changes = [];
    let touched = 0;
    for (const row of rows) {
      let data;
      try { data = JSON.parse(row.data); } catch (e) { continue; }
      const before = Array.isArray(data.tags) ? data.tags : [];
      const after = canonicalTags(before);
      for (const t of before) if (!canonicalTag(t)) dropped[t] = (dropped[t] || 0) + 1;
      if (before.join("|") === after.join("|")) continue;
      touched++;
      changes.push({ title: row.title, before: before, after: after });
      if (apply) {
        data.tags = after;
        await env.DB.prepare("UPDATE recipes SET data = ? WHERE recipe_id = ?")
          .bind(JSON.stringify(data), row.recipe_id).run();
      }
    }
    return jsonResponse({
      applied: apply, recipesScanned: rows.length, recipesChanged: touched,
      droppedTags: dropped, changes: changes
    });
  }

  /* ---- create or update one recipe ---- */
  if (route === "recipe/save") {
    const visibility = VISIBILITIES.indexOf(body.visibility) >= 0 ? body.visibility : null;
    if (!visibility) throw new ApiError(400, "Choose private or shared with friends.");
    const { title, text } = validateRecipeData(body.data);
    const now = new Date().toISOString();

    if (body.recipeId) {
      const owned = await env.DB.prepare(
        "SELECT recipe_id, updated_at, updated_by, locked_by, locked_at FROM recipes WHERE recipe_id = ? AND cookbook_id = ?"
      ).bind(String(body.recipeId), me.cookbookId).first();
      if (!owned) throw new ApiError(403, "You can only edit recipes in your own cookbook.");

      const holder = liveLockHolder(owned, me);
      if (holder && !body.takeover) {
        const err = new ApiError(423, holder + " has this recipe open in the editor.", "LOCKED");
        err.detail = { lockedBy: holder, lockedAt: owned.locked_at };
        throw err;
      }

      /* Optimistic concurrency: the client tells us which version it started
         from. If someone else saved in the meantime, refuse and let the
         person decide, rather than silently overwriting their work. */
      const base = cleanString(body.baseUpdatedAt, 40);
      if (base && !body.force && owned.updated_at && base !== owned.updated_at) {
        const err = new ApiError(409, "Someone else saved this recipe while you were editing.", "CONFLICT");
        err.detail = { updatedBy: owned.updated_by || "Someone", updatedAt: owned.updated_at };
        throw err;
      }

      await env.DB.prepare(
        "UPDATE recipes SET data = ?, title = ?, visibility = ?, updated_at = ?, updated_by = ?, " +
        "locked_by = NULL, locked_at = NULL WHERE recipe_id = ?"
      ).bind(text, title, visibility, now, me.username, String(body.recipeId)).run();
      await applyVisibilityReach(env, String(body.recipeId), visibility);
      return jsonResponse({ recipeId: String(body.recipeId), updatedAt: now });
    }

    const recipeId = newRecipeId();
    await env.DB.prepare(
      "INSERT INTO recipes (recipe_id, cookbook_id, owner_username, owner_lc, visibility, title, data, created_at, updated_at, updated_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(recipeId, me.cookbookId, me.username, me.usernameLc, visibility, title, text, now, now, me.username).run();
    return jsonResponse({ recipeId, updatedAt: now });
  }

  /* ---- editing locks ----
     Claimed when someone opens the editor, refreshed while they are in it,
     and released on save or cancel. Locks expire on their own so a phone
     that goes to sleep mid-edit cannot strand a recipe. The version check
     on save still applies underneath, for the window where a lock lapses
     while its holder is genuinely still typing. */
  if (route === "recipe/lock") {
    const recipeId = String(body.recipeId || "");
    const row = await env.DB.prepare(
      "SELECT recipe_id, locked_by, locked_at, updated_at FROM recipes WHERE recipe_id = ? AND cookbook_id = ?"
    ).bind(recipeId, me.cookbookId).first();
    if (!row) throw new ApiError(403, "You can only edit recipes in your own cookbook.");

    const staleBefore = new Date(Date.now() - LOCK_TTL_MS).toISOString();
    const now = new Date().toISOString();

    /* One conditional statement, so two people tapping Edit at the same
       moment cannot both win. */
    const sql = body.takeover
      ? "UPDATE recipes SET locked_by = ?, locked_at = ? WHERE recipe_id = ?"
      : "UPDATE recipes SET locked_by = ?, locked_at = ? WHERE recipe_id = ? " +
        "AND (locked_by IS NULL OR locked_by = ? OR locked_at IS NULL OR locked_at < ?)";
    const binds = body.takeover
      ? [me.username, now, recipeId]
      : [me.username, now, recipeId, me.username, staleBefore];
    const res = await env.DB.prepare(sql).bind(...binds).run();

    if (!res.meta || res.meta.changes === 0) {
      const held = await env.DB.prepare(
        "SELECT locked_by, locked_at FROM recipes WHERE recipe_id = ?"
      ).bind(recipeId).first();
      const err = new ApiError(423, (held && held.locked_by ? held.locked_by : "Someone") +
        " is editing this recipe right now.", "LOCKED");
      err.detail = {
        lockedBy: held ? held.locked_by : null,
        lockedAt: held ? held.locked_at : null,
        expiresInSeconds: held && held.locked_at
          ? Math.max(0, Math.round((LOCK_TTL_MS - (Date.now() - Date.parse(held.locked_at))) / 1000))
          : 0
      };
      throw err;
    }
    return jsonResponse({ ok: true, updatedAt: row.updated_at, ttlSeconds: Math.round(LOCK_TTL_MS / 1000) });
  }

  if (route === "recipe/unlock") {
    await env.DB.prepare(
      "UPDATE recipes SET locked_by = NULL, locked_at = NULL " +
      "WHERE recipe_id = ? AND cookbook_id = ? AND locked_by = ?"
    ).bind(String(body.recipeId || ""), me.cookbookId, me.username).run();
    return jsonResponse({ ok: true });
  }

  /* ---- lightweight poll: has this recipe changed under me? ---- */
  if (route === "recipe/version") {
    const id = String(body.recipeId || "");
    let found;
    try { found = await loadRecipeForReader(env, me, id); }
    catch (e) { return jsonResponse({ gone: true }); }

    const voices = [me.cookbookId].concat(await friendCookbooks(env, me.cookbookId));
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM comments c JOIN users u ON u.username_lc = c.username_lc " +
      "WHERE c.recipe_id = ? AND u.cookbook_id IN (" + placeholders(voices.length) + ")"
    ).bind(id, ...voices).first();
    const lastRow = await env.DB.prepare(
      "SELECT c.username FROM comments c JOIN users u ON u.username_lc = c.username_lc " +
      "WHERE c.recipe_id = ? AND u.cookbook_id IN (" + placeholders(voices.length) + ") " +
      "ORDER BY c.created_at DESC LIMIT 1"
    ).bind(id, ...voices).first();

    return jsonResponse({
      updatedAt: found.row.updated_at,
      updatedBy: found.row.updated_by || found.row.owner_username,
      comments: countRow ? Number(countRow.n) : 0,
      lastCommentBy: lastRow ? lastRow.username : null,
      lockedBy: found.ours ? liveLockHolder(found.row, me) : null
    });
  }

  /* ---- bulk import into my cookbook ---- */
  if (route === "recipe/import") {
    const visibility = VISIBILITIES.indexOf(body.visibility) >= 0 ? body.visibility : null;
    if (!visibility) throw new ApiError(400, "Choose private or shared with friends.");
    const incoming = Array.isArray(body.recipes) ? body.recipes.slice(0, MAX_IMPORT_RECIPES) : [];
    if (!incoming.length) throw new ApiError(400, "There was nothing to import.");
    const now = new Date().toISOString();
    const statements = [];
    let count = 0;
    for (const item of incoming) {
      const { title, text } = validateRecipeData(item && item.data ? item.data : item && item.body);
      const recipeId = newRecipeId();
      statements.push(env.DB.prepare(
        "INSERT INTO recipes (recipe_id, cookbook_id, owner_username, owner_lc, visibility, title, data, created_at, updated_at, updated_by) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(recipeId, me.cookbookId, me.username, me.usernameLc, visibility, title, text, now, now, me.username));
      count++;
      /* An imported file may carry the cook log from an older export. */
      const log = Array.isArray(item.cookLog) ? item.cookLog.slice(0, 200) : [];
      for (const entry of log) {
        const rating = Math.min(5, Math.max(1, Math.round(Number(entry && entry.rating) || 0)));
        if (!rating) continue;
        statements.push(env.DB.prepare(
          "INSERT INTO comments (comment_id, recipe_id, username_lc, username, rating, comment, cooked_on, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(newCommentId(), recipeId, me.usernameLc, me.username, rating,
          cleanString(entry.notes || entry.comment, MAX_COMMENT_CHARS),
          cleanString(entry.date, 30) || now.slice(0, 10), now));
      }
    }
    await env.DB.batch(statements);
    return jsonResponse({ count });
  }

  /* ---- privacy toggle ---- */
  if (route === "recipe/visibility") {
    const visibility = VISIBILITIES.indexOf(body.visibility) >= 0 ? body.visibility : null;
    if (!visibility) throw new ApiError(400, "Choose private, selective or shared with friends.");
    const recipeId = String(body.recipeId || "");
    const res = await env.DB.prepare(
      "UPDATE recipes SET visibility = ?, updated_at = ?, updated_by = ? WHERE recipe_id = ? AND cookbook_id = ?"
    ).bind(visibility, new Date().toISOString(), me.username, recipeId, me.cookbookId).run();
    if (!res.meta || res.meta.changes === 0) throw new ApiError(403, "You can only change recipes in your own cookbook.");
    await applyVisibilityReach(env, recipeId, visibility);
    return jsonResponse({ ok: true, visibility });
  }

  if (route === "recipe/delete") {
    /* Any pin waiting on this recipe goes with it. */
    const recipeId = String(body.recipeId || "");
    const owned = await env.DB.prepare(
      "SELECT recipe_id, locked_by, locked_at FROM recipes WHERE recipe_id = ? AND cookbook_id = ?"
    ).bind(recipeId, me.cookbookId).first();
    if (!owned) throw new ApiError(403, "You can only delete recipes in your own cookbook.");
    const deleteBlocker = liveLockHolder(owned, me);
    if (deleteBlocker) {
      const err = new ApiError(423, deleteBlocker + " has this recipe open in the editor.", "LOCKED");
      err.detail = { lockedBy: deleteBlocker, lockedAt: owned.locked_at };
      throw err;
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM comments WHERE recipe_id = ?").bind(recipeId),
      env.DB.prepare("DELETE FROM recipe_marks WHERE recipe_id = ?").bind(recipeId),
      env.DB.prepare("DELETE FROM pending_pins WHERE recipe_id = ?").bind(recipeId),
      env.DB.prepare("DELETE FROM recipe_shares WHERE recipe_id = ?").bind(recipeId),
      env.DB.prepare("DELETE FROM link_grants WHERE recipe_id = ?").bind(recipeId),
      env.DB.prepare("DELETE FROM recipes WHERE recipe_id = ?").bind(recipeId)
    ]);
    return jsonResponse({ ok: true });
  }

  /* ---- a scanned recipe code ----
     Two passes. preview answers "what is this and what will happen", so the
     app can ask before acting in somebody's name; the real call then does
     whichever of the three things applies: open it, pin it, or ask to be
     friends and remember the pin for when they say yes. */
  /* ---- pin something arrived at by link ----
     A link no longer asks anybody to be friends. It hands over one recipe and
     nothing else, so pinning what it points at writes a grant for that single
     recipe. The grant lives in its own table because the owner's sharing
     checkboxes rewrite recipe_shares wholesale, and a pin somebody took ought
     not to evaporate the next time the owner edits who they ticked. */
  /* Taking a link recipe into your library. The grant is the part that makes
     it visible at all; the mark on top says which shelf it went on. A bare
     null asks for the grant alone, which is what scheduling needs - a dinner
     on Tuesday is not a favourite and should not pretend to be one.
     Defaulting to the pin keeps every older caller doing what it always
     did. */
  if (route === "recipe/claim") {
    const recipeId = cleanString(body.recipeId, 64);
    const mark = body.mark === null ? null
      : body.mark === undefined ? "pin"
      : cleanString(body.mark, 12);
    if (mark !== null && MARK_KINDS.indexOf(mark) < 0) throw new ApiError(400, "Unknown mark.");
    const row = await env.DB.prepare(
      "SELECT recipe_id, cookbook_id, owner_username, visibility, title FROM recipes WHERE recipe_id = ?"
    ).bind(recipeId).first();
    if (!row) throw new ApiError(404, "That link points at a recipe that is no longer there.");
    if (row.cookbook_id === me.cookbookId) {
      return jsonResponse({ recipeId, mine: true, owner: row.owner_username });
    }
    if (!isShareable(row.visibility)) throw new ApiError(403, "The owner has not shared this recipe.");
    await throttleGuard(env, ["cb:" + me.cookbookId, "ip:" + ip]);
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO link_grants (recipe_id, cookbook_id, created_at) VALUES (?, ?, ?)"
    ).bind(recipeId, me.cookbookId, now).run();
    if (mark) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO recipe_marks (cookbook_id, recipe_id, kind, created_by, created_at) " +
        "VALUES (?, ?, ?, ?, ?)"
      ).bind(me.cookbookId, recipeId, mark, me.username, now).run();
    }
    const map = await membersOf(env, [row.cookbook_id]);
    return jsonResponse({
      recipeId, pinned: mark === "pin", mark: mark, owner: row.owner_username,
      household: householdLabel(map[row.cookbook_id] || [row.owner_username])
    });
  }

  /* ---- copy a friend's recipe into my cookbook ---- */
  if (route === "recipe/merge") {
    const found = await loadRecipeForReader(env, me, String(body.recipeId || ""));
    if (found.ours) throw new ApiError(400, "That recipe is already in your cookbook.");
    let data;
    try { data = JSON.parse(found.row.data); } catch (e) { throw new ApiError(400, "That recipe could not be copied."); }
    data.mergedFrom = { username: found.row.owner_username, date: new Date().toISOString().slice(0, 10) };
    const { title, text } = validateRecipeData(data);
    const now = new Date().toISOString();
    const recipeId = newRecipeId();
    await env.DB.prepare(
      "INSERT INTO recipes (recipe_id, cookbook_id, owner_username, owner_lc, visibility, title, data, created_at, updated_at, updated_by) " +
      "VALUES (?, ?, ?, ?, 'private', ?, ?, ?, ?, ?)"
    ).bind(recipeId, me.cookbookId, me.username, me.usernameLc, title, text, now, now, me.username).run();
    return jsonResponse({ recipeId });
  }

  /* ---- cook log entries (rating required, comment optional) ---- */
  if (route === "comment/add") {
    const rating = Math.round(Number(body.rating));
    if (!(rating >= 1 && rating <= 5)) throw new ApiError(400, "Pick a rating from 1 to 5.");
    const found = await loadRecipeForReader(env, me, String(body.recipeId || ""));
    const cookedOn = /^\d{4}-\d{2}-\d{2}$/.test(body.cookedOn || "") ? body.cookedOn : new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO comments (comment_id, recipe_id, username_lc, username, rating, comment, cooked_on, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(newCommentId(), found.row.recipe_id, me.usernameLc, me.username, rating,
      cleanString(body.comment, MAX_COMMENT_CHARS), cookedOn, now).run();
    return jsonResponse({ ok: true });
  }

  if (route === "comment/delete") {
    const res = await env.DB.prepare(
      "DELETE FROM comments WHERE comment_id = ? AND username_lc = ?"
    ).bind(String(body.commentId || ""), me.usernameLc).run();
    if (!res.meta || res.meta.changes === 0) throw new ApiError(403, "You can only delete your own cook log entries.");
    return jsonResponse({ ok: true });
  }

  /* ---- friend requests, cookbook to cookbook ---- */
  if (route === "friend/request") {
    const buckets = ["cb:" + me.cookbookId, "ip:" + ip];
    await throttleGuard(env, buckets);
    const name = cleanString(body.name, 40);
    if (!name) throw new ApiError(400, "Type a username.");
    if (name.toLowerCase() === me.usernameLc) throw new ApiError(400, "That's you.");

    const them = await findUser(env, name);
    if (!them) {
      await throttleRecordFailure(env, buckets);
      throw new ApiError(404, "No one here goes by that name.");
    }
    if (them.cookbook_id === me.cookbookId) {
      throw new ApiError(400, "You already share a cookbook with " + them.username + ".");
    }

    const map = await membersOf(env, [them.cookbook_id]);
    const theirMembers = map[them.cookbook_id] || [them.username];
    const existing = await env.DB.prepare(
      "SELECT requester_cb, addressee_cb, status FROM friendships " +
      "WHERE (requester_cb = ? AND addressee_cb = ?) OR (requester_cb = ? AND addressee_cb = ?)"
    ).bind(me.cookbookId, them.cookbook_id, them.cookbook_id, me.cookbookId).all();
    const rows = existing.results || [];
    const now = new Date().toISOString();

    for (const row of rows) {
      if (row.status === "accepted") throw new ApiError(409, "You are already linked with " + them.username + ".");
      if (row.status === "pending" && row.requester_cb === me.cookbookId) {
        throw new ApiError(409, "Your cookbook has already asked " + them.username + ".");
      }
      if (row.status === "pending" && row.requester_cb === them.cookbook_id) {
        await env.DB.prepare(
          "UPDATE friendships SET status = 'accepted', responded_by = ?, updated_at = ? " +
          "WHERE requester_cb = ? AND addressee_cb = ?"
        ).bind(me.username, now, them.cookbook_id, me.cookbookId).run();
        await resolvePendingPins(env, me.cookbookId, them.cookbook_id);
        return jsonResponse({ ok: true, accepted: true, username: them.username, members: theirMembers });
      }
      if (row.status === "declined" && row.requester_cb === me.cookbookId) {
        /* They said no once; nothing about that is worth spelling out. */
        await throttleRecordFailure(env, buckets);
        throw new ApiError(403, "That request couldn't be sent.");
      }
      if (row.status === "declined" && row.requester_cb === them.cookbook_id) {
        await env.DB.prepare(
          "DELETE FROM friendships WHERE requester_cb = ? AND addressee_cb = ?"
        ).bind(them.cookbook_id, me.cookbookId).run();
      }
    }

    await env.DB.prepare(
      "INSERT INTO friendships (requester_cb, addressee_cb, status, requested_by, created_at, updated_at) " +
      "VALUES (?, ?, 'pending', ?, ?, ?)"
    ).bind(me.cookbookId, them.cookbook_id, me.username, now, now).run();
    return jsonResponse({ ok: true, accepted: false, username: them.username, members: theirMembers });
  }

  if (route === "friend/respond") {
    const action = body.action === "accept" ? "accepted" : body.action === "decline" ? "declined" : null;
    if (!action) throw new ApiError(400, "Accept or decline?");
    const them = await resolveCookbook(env, cleanString(body.name, 40));
    if (them.cookbook_id === me.cookbookId) throw new ApiError(400, "That request isn't from another cookbook.");
    const res = await env.DB.prepare(
      "UPDATE friendships SET status = ?, responded_by = ?, updated_at = ? " +
      "WHERE requester_cb = ? AND addressee_cb = ? AND status = 'pending'"
    ).bind(action, me.username, new Date().toISOString(), them.cookbook_id, me.cookbookId).run();
    if (!res.meta || res.meta.changes === 0) throw new ApiError(404, "That request is no longer waiting.");
    /* Anything either side scanned while waiting can be settled now. */
    if (action === "accepted") await resolvePendingPins(env, me.cookbookId, them.cookbook_id);
    const map = await membersOf(env, [them.cookbook_id]);
    return jsonResponse({ ok: true, status: action, members: map[them.cookbook_id] || [them.username] });
  }

  if (route === "friend/remove") {
    const them = await resolveCookbook(env, cleanString(body.name, 40));
    if (them.cookbook_id === me.cookbookId) {
      throw new ApiError(400, "You share a cookbook with " + them.username + ", so there is no link to remove.");
    }
    const map = await membersOf(env, [them.cookbook_id]);
    await env.DB.prepare(
      "DELETE FROM friendships WHERE ((requester_cb = ? AND addressee_cb = ?) OR (requester_cb = ? AND addressee_cb = ?)) " +
      "AND status IN ('accepted','pending')"
    ).bind(me.cookbookId, them.cookbook_id, them.cookbook_id, me.cookbookId).run();
    return jsonResponse({ ok: true, members: map[them.cookbook_id] || [them.username] });
  }

  if (route === "friend/allow") {
    const them = await resolveCookbook(env, cleanString(body.name, 40));
    await env.DB.prepare(
      "DELETE FROM friendships WHERE requester_cb = ? AND addressee_cb = ? AND status = 'declined'"
    ).bind(them.cookbook_id, me.cookbookId).run();
    return jsonResponse({ ok: true });
  }

  throw new ApiError(404, "Unknown request.");
}

const ICON_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAAovUlEQVR42u29ebAd13Xe+621d3efc+6AeSQGEgMBUAQpkqA42LTkpzGWIrnsOHLJdqzIQ0ouJ3kZXIle5KrY9apcGZ7lKYmTOLEtx8mjZcvWkyXTjiRSpERKJATOBAmQmIiZAO58zunuvdf3/uhzMZAXFCQBJEDu74/LU+Tl6b69f732WmuvvZeQxHcoMwpAo5mJt2BmWhQqCgDozowd2rvn4K69h3fvnjl0oDp8OJw6ielprXpmRlJEkPQ9i6SqiihbLR0ZyRYvyVdeNbJ67eprr11x9aqV11yTtRcAMKCK0VlwzkWoqgohwMUaBPkuAIIFwGrRklKoywAAJw/s2/nQN/c+8siRnTt7R48OjU2ImUr0Hl7FnFTODS6ZALpIADUfihBgCBF1BKBU50dG26tWLrnphjXfd9u6bbfMW3yVABrBECWToCZQB33dAKpoRivUC1DPzDx2/1ef/OKf73l0R3Xi5HCwUdG2U+ZmKiUsqASFp89rMTIBdBEBEgCqvYwGemNG5ISQgShDmKlC9MW8pUu2vO0dm3/oh9f9wG3iXQVkIag4OHmtATIzEYkhKDLNMDU5+cDn737ys3/Sf2pnFlm025kXMBIRhNELRalKERMqgotp1C+FXMwBmJBiJowaoaVCMzgXNZaxX5bddnvxzTd934d/Yut73+/zPNakROfc9/4+fwcA0SzG6LMslP0H/+yzD3/6j3u7d7ayKh/2LuSMNJBiFJpIRC4URzpCDRBGtTTYlwQgUwAGMUVUCtkONaHBIYhQlB5qgZOhjH7Rrbd8/8//9PXvej8goa6997hkABGY/U8UGs2pA/bs2P5Xv/5rh7750ALfHvW5gRVjdCqEEkoKIRATEKTQlIQJIHRpsC+JpAYgJgJVApAoSggAJQAIhIR3YmJTdbdite59H3rvL/6zpes3mVEB6GBGNEAgCiEg3z1ABMQGAFEAhkCXZVVV//Xv/e723/2dkV63NTxkZkYKIGdAO+t7Z78p6TWi6KzRe5WBUFUBJmfGdNmKd//D/2vbhz8cAcbSw5miFvGAo0YRvTCG5rRABioIKCrAYiycO3To+T/75K9MfOXr8+bldEBMDs0VDJt4RS/OVLbhx37kg//qXxQjiyyaOCeABACEJy4sTHslQEZQzMFAsCfWcW739od//xP/ZHjf3mWtzhTERByYrMuV7HcrvIireyemFm27/Yc/9amFa9d3Y/SquQkEtUYPlQuwQTqXMSQEFNRV1XHu0b/5yz/4hV9Yvffokk5+PO/XzhwTPVey/SGmCsy4uuhXi0aHDj/x6B/+/Z89/tijHef6dR0cosIu2PuYwwIBrODqGIece+Tzn/3TX/6Xy2J0PosxQOgNlCaZmXSlqnbRmeVRe05dnmNsJi5Z8ZHf/Y9X3XhzaVaokhfqBekr01O0EGMccu7R//3Fz3zyE6vrOnOYlmDi2rVTSjI/V7QIDFfITKZyTzjfr7ORQsYO/8nHP37i6ScL1VDVCDTMDjRfLSB6hQUyq0KZ5+3d27/53//BLywtJ52zSNVZ65QszxuDITkrQCPQFutOV9hw7c/9/u+3l69kRW1lctrA8NxI71UskFF81n7x8O4/+MQ/XTMxKeomndPZyyR63kgx/+lEnwJVLbagFZ5/9rP/7J+yKsV5NV7IcOtZkxcsxiisq/LPP/mrQ/v2uk4wWCtomrPe8Aapn/tWLyxrZwe/8cA9/+bf+0zMIoyDCUrOazzOBsiiWab6xf/yHya//LUVneETWRRwKKR84JvBJrGIOiUcmTfy1B9++pm/+gvnfQyhAYjnzwmf8YFCHXzmn9/+8B997CML4UjWzvIozhDSIsQbXe2ak4UEdcMla/Z05eKP/a97hhcuAU39YBl8TgrUjIihpik09rv3fOrXhvt9OpggjwpJ9LwpFFUAeAMVvt3q7j341d/5dXXCKLBARHceE6QCQCzQNNNHPvf5I4883OoMIZqClJQwfLOodMgNuUUTsxpDQ/Me/4s/PbTjW65QY3DnD+MVRC2ai05Mjj/w3/5ggW9b8nnelHHZOdUXTqXbvf8//SewCuoluHielTE1i32DE33w85+Z2b1zxOWW7E6a0czmFa39X/vKnh1fy8RbHe28Fkit5Xw5Pf3Yn/6/w0WMjCnTnAQCLkeYfuR//E8xxkwEYW6AojEDnrz//vLpZ31HK2HKFiYppYL6kdaRe78+9swuehWrzjOFuRwWH//Cn2UUtVZUlwxQEkClCUbtxPTOL/1ZDiAWcwNUqJw6sH/Po98q2m1asj5JpxEymPg8e/yB+2I1oermjMRUgGe/+XAYG8+cEJYq35MAUECBWnCd/PgLLxx+6hnx4FyOtALc8/A3h4MB0YSaQrCk2cDeGWNGmZ46+I1HcJ5MkPamTh55dueoKBgJpoXTJMxuqHBkLaFDHtm+A7A5NwDpwX17u0eOtZ0aSYGkLGLSIBAjAJKFz4/t2dObOKUiryyF14O79w+NT1kWQW/wlFT0kwQlvGlw0ZuEYvjY5KnpvXvnnMX04HO7hGYqQhWKpTRiEgCBCU0gRC5OprrH9u4DQHt5kOV7Rw6qxEpECUemiuekgQ8kIIQUbyjKsjpyZG5bVR0+5B1qhVKdSQIoaVZmQoMC8AhTxw4BcxwrpHFszDsJCjFRkkiJoCQICZiJ1CrRKzKOT53AXHWtalMTAdSoFCAthCXN+kCAKKGwgBiBXrc/5y96V/VDlrWCBB+RztBIGvhAQnHeAFIyqHgrMfcUZmYAUg1Q0vlMEUlAYjxPOUc69TLp2/jSPP+2QkAbehJDSa/mDp1/Y4+mB5T0vSgBlJQASkoAJSWAkhJASUkJoKQEUFICKCkBlJSUAEq6tPJX/F8wu4p39mIe5/rH93qdb/9Fcu4PvPzyb8SSh8sLoLMGSZqyXIBnTjUXUCAiwllqaLRIkmAk0VQWEKIqIhCoNB/ESIJGgmya9RnYVNApMXv4ddPD7cyhts31BQhKAkIIqBCCBsrsZUSkOWDbzECQgz40BBXS9AIVEVE3WLRudsyYBW0udObkdp71DKTpdZMAutDZdHAgqJBCKAW1QMBM4CFqtBj6rEMdaKAR4jreF16ZeeQ+a7cokGBClGVpdYgx9KterKOIqkIzdd7BOfOOwZRQo0YRqkBNaGoEhEaBSdNqS5yJIwxGIQUmMIFT1VBbtKqOjBYDIZYVLssydd7nrTzPgoCZkxDrXok6SB2rsiqrigoqxIvPfCZORQkhzQwQEdNBPXvzk+DlXShxGQFUqwgAQsUE5iGjtZCsovVDDEaf56Pzl46uWD5/1YrFa9cWSxfNX7R4eOFCPzwkeabew4kEI2khxH6/N9OdHB+bPnx46uixo/sOTB84PHP8eDnZrdlt5YXP1ClUrK+x71VJ3+BiYtL0i7DgUHkA7AR6ikEtSFWGsq69z/LR4YVrlo6sWbV8zerO8uWjK1eMjo4WnY5rtUQVTugU0WIdpKzLiamxyRMTY6emjxw/vu/A1KEj40eO4cRUHSrNvebqMoWQEgyIAlCaQq3LfK/wZQSQp5JUgRcxC6Eqx8ogeauzYvnaazetuWHryo0b5l29ZmTxAuu0mfvKQSr4AIIRjGYEnaiQmWom0lZd4hwcGYMrQzk2MXn0+JHndp/a/sTe53YeOXSg7E8VmRR5niMqIVEErhbSCUklfDQ6ipNKbbpf1xGd4QVXrd989VuuG33bW5ZtWDe6dJGOjjB3ojlqiTE2UxlIUzFSgUJUIC2ReY6ZKiJR1ZiemXjp5LGDLx7atXv/o49P7n6hPvqSxhrDzvuccCZommNf5l3X5FNbN1wmt5KbU3XduuzWpSvyJWtXr7r9ps233bZsw8b20iVoFRWtjDGGiAhSlCJiAhuUPMnAe5AzZxcTFLVMCDqIF5d59WoIHBt/6eldex98eN9D24/t3q1Vv1N01Lta0WUdVTJIm5oF1HVdlv18ZN6K67asufNta++4ZdGm9RzuEGp1CHWUQBIUUmZ3jwsEwtmj/aU5TJmM8EaIQmDq1HvnsyyHsNudOHTk6LPP7nzwoSM7njhx5KjUsZPlLZcb4+veKlRUq+mp5Xfe9VOfvvuV9auXBUAEnGrol70YhlevXn/H7W99x9tXbt6sSxaB6NdVZaEGHNiKpiJKVVOlBGVwZzbTDvxQOeMGC8VFJxATM5iJGS2oZKKtvBCn1fT0oceefOqvv/TcQw/3jx5pec1ajk4QGHqxMgyvXn39279/y3vfvXzTRmm1GOteXUXSEwpVOKUI1GDRhzPud9ObnbMuucy6eZCoDGpRIoF2qSDNixQerTwz2ovH9z/11OP33bv3Gw/3j7000mqpG7TXktfJFl2mADWvZ7OTsWU6FarO2tXv/MmPrL/jtnzFcqrO1CEGQMQ3e/oFQHCoo0hUMWmOgchAPT1GMmBn8JNN60+yCekAUiigiw4ESYVCpdVuqXD8+b3P3PM3T3zhC+MH9nuLcH7Zddff9MMf2vD2u9pXLbeaVb8yMQOpQkFUgNJEUWIqABtTwQHE0lxWGlMEQiBBEJVwNCUE7LsMEEeFUSKoQOGGvENZdV88+Ph99977x3cX4zO50yDRVHzUQVyaADKoN/SyOoeMjtE2XvXh3/yt0Wuu6fcnS6EavajJmdcuKpSWW6xVm+hXTby5M1vZzir9tiaMURAwAQgHuKZ7CJsAe9YoEAYJcHkhbS/lsWM7vnDP3u07bn3Puzf84F0yMtINVgVmpOJMebCczjUICGn2kLszEycgUMPLDqqonVFMm0azpJBRckAUBNj8sRLZDJI615o3+vy9D/zpP//kSG+6zuuu0+EyV7J2r+lJcq8O0OvmRCuahr0SRaZRf/CjPzm6bnV3/GRoZxBRiBqKCAOiNvYEClVzjpDQBPqIsNpBGs26Hs0+lEiaUYCsybaIyhkCnJyVevJEhtivQzdEv3j0lp/9iVt/+iPOuemqjGUvo+9QDWc2fc/+v1EAtYZBGqQWDwi0yQuJNadzk8QgAeUrUegg06gCoBVIYRQEbTpFQps/BbAYJ4+f2HDX7Tf86N969Pc+vci3ItgE95dVWP+6AURASUepA4cWLVp249ay7tYt3+Tpml8IgqinAWI09FRVpfAuc86JwtEkhjqEGC0Gi6YqUFHvWlkmzhmYBQ0h1sHqGA1wqjmjyJkmIZRIGBQivo6sQ52ZB6NppkoYCb7M+4hg3+cWY6aaqxbeZd45FQFiCLEOjGaMRHTOOVXvvfNezcEYzapoZQgG1lJTAFWl8yZqPH2et4o4kT7Cqju2fevTd/uamUdUXm4x2esIEAF4Ihqy9hCKPDiFRbVZX1gRVCvGKHTEsC98lkfHMDMzffTIyWPHjh49NLP3EI6eGp+YKMuqLMsYo1N1qq1Ou2i3h+eNLlq5wq5Zs3TNmiWLl80fno+sxapfhmmLEbPvehQxFaW0ozqKi9IkpqNjUERFJXBswio25wRmLuu4YW35qt+dnhrbf+zIxL4D3Hvw5LHjvanpXrdb90pjCIiZz4q8KFqt+Qvm86pF869evWT5ioVLlw0tWpwVrVp9Fat+v/ZGb97DRcQzPqJIhKLdlrxldYmBL5UAOh0rwZxJZipRjc5RsjgIhE1hhAs21G5JnmO6d3LPkYPPPHPwmccPP//8+Isv9ibG6lgVVWzVoqrO6ZnomRwHQowGE+fo1I8MF0uXLNqw4eobtq654foFmzYNDQ9bXVf9PkhRVcuUGJxH4YkzJ0yINj6W0czU+WKo5bwfO3ny+BOP7nviyf1PPjm5d3/90sk40wUDjBk0E3UUikSVHkEyWqSxn6P2qq12e+HipWvWrFq/8eobtqzcvGH+VSsx3K56IVS18uzlHGSmrcoZpXZau6hGucwYej0tECGAQmqRWiEy26WTAw4QvYzt3PnC/V/f+fjjR57d0xufaIWqENdRme9EtYgdrbXZfMvBrESICgE/YBSFxdifKfdOHnj++X1f/CsdHhnZdO3mW7dd//a7VmzeFFr5TNmLde3VZUahlE4oojAAzghqBcuLYigv6snJ5x966ImHHty9fUfc/ULs9zPVwmHYexnKKleAFMOgNQnppTlogBlEROYHE7IurTx87PiBI4e/+uD2zOVLlyzfvOG6226++gd+IFu+Mg88e5b3RhPzYFTysswovm4AiRCiJmIaTKszYXjjYxoUmMn4R7/xG92vPNAZzhdrUReFFi2CRpQgCSERefacCIDxHG+3hBN1mUMuAgHqELc/9o3tO77+J59ZftNbb33Pe97yfbfli0amyx4IH30UFaggBmewmHvXGRqZOHjkK1+571tf+tLJnTvz6e6o+jzPZGi4cdkjgUiNg2vaaQNyZvmdBHvSrKmKB7LcKTK12D156vh997/wl5+76Wc+9sFf/te9akr17Bob62V0NIo5stmIngCacxn+5ROcEFlgLi4bmZe1nFbkuY085EK/moMBbNbAVePo0LCqVeHEvV+750sPPLph49a/+6G3/O13V63CvAgHfa40imo29dKpb/zBHz/x+b8cP3CwUF3eahfteRZCgJnZd/NHNnEZMagOyLJOMSIMeVSt7ds/mstMl29BmQCZiUaijhKj2MUqbaA3oq69xfltv2DYT+/Z9f/9m08de3Z30WrXDW1iEDCi1Wk/dt9XP//rv50fPbqmnS3JvIshxGB6EXJ5g3oVEiG6YC4S1CvuiILLu6BsUJ+DJvNrFyMFooSL0RRRWAujcqiTLTDvgmVRKwoEUegNgJiIU6zK2211pQVCCDVHABe3pYidhulK02Vd0srZhF2TaosX4/WkwLRJU6uPrqhzmlZaKemiZFFMzKSZKqV2EjVmdUVzUbImA+kN/iKN9OmgITZrI+7KO6X7MgWoCVajNksEg1zixaqMMYGJAFRAQW2WyIQQo1Bo3mb/xWwSMTa1OqeX1y/S6xEVRURQUJAHXIlHdF/eFkgGdaV8tc7l36XPTqCpQsTpBg/CZmVfKYTIWcv7poPltcGq7EW5FwEBNxs9ZldmwXTalXF5zdcJoKQ3lxJASQmgpARQUgIoKQGUlJQASkoAJSWAkhJASUkJoKQEUFICKCkBlJSUAEpKACUlgJISQElJCaCkBFBSAigpAZSUAEpKSgAlJYCSEkBJCaCkpARQUgIoKQGUlABKSkoAJSWAkhJASQmgpKQEUFICKCkBlJQASkoAJSUlgJJeH/kr9cabfqeDH3M1HjjTVHeOrrmX8GZmP8x9O4OmZUwAvaaiQEREVWTQOy7GaDEyRpqZWTMq5OzYiaioqDT9VJ1zqg4qTRtuNi0yv1dkBj17SbNoMUaz2ZuxQT/Pwf3I7L2rE3XOOXUKEeigtS4FlATQJYAmi5rBmUheowwhVP28KuvMxTwfmj9/aHhU581vL148Om80K/KsU6hz0Qhj1e32Jqd609PTp07FU2PdqcmZmS5jJcLcZ22Xw6mp1GSEqAJUoUSRoMhhFLhIQJSIAgqzIGZiSjoxFYvByl4IwaCat1pDwyMjo+0FCzsL5hejQ8X8UWm3lMhFYhXqXr/qVxPj4+WJ4zY1OTk52Z+azsroAiV3MY/t6HzwVAexBNDFAwhw0Ol+OT4zM+o7umTxytVrVq9fvWTjuuG1a0aWLJ83NE86w8gyeIUTeCFAUTXCDFWNqkYI3Znp7tj49MHDx3ftnnx+75E9L7z40uGqO5OL62SttqonS0KjCCSKgEqJjqwEGYQiQrXMl7DQL9mrJcbOyMj8jVcvX79+0YZ1SzZsaC9fOjpvftbpwHu0cmTeVCBQGiiIRB1hRNULvamJycnpIy9N7D144rl9h/Y+/+LxfTg5xqneTB1n+wElgC6Ofy816+Vbr33LDddtuvWmZes3thcuwminVtSiIXKyolpJ61qF2d7cFDgnTkgFVSm5z7NV7cVXL9p849r3/1AZq3Ji/NTuPS8+9cyehx4+9fRz3eNjhVKGCwU1wpuaqJqYoO+ZCTN6ja7bnZ6hjS5btvb6rZtvuWXFdVuyjWvbo/McHGvCpLJyRmaUpnWJfuUoldRBqSowajPf5QU7I/nyNUs26aq3qwusumOTp46e3Pnsrq8+PH/NVYxRVBNAF8kCkUH5kX/0i8hbUM4Q03X0k9OmSnGe8JTasfZeCWlaiAuEDlQKDQgCAjOuIiutLavoyCIfWnPTtmtuedsP/NiHJw7s2/3I9qfvu++FJ5/uW0DTyxBeQBOrlSJSlXWvKLbddfvGu+5YddMN7atXVUN5N5r06u7MjEFMBKoqksWiaSNGJ0HooZ6RAB0MMKAVIHUVyopAaRSiLtqdVesWr7lm0zvfW1e96djz4hNAFzG60RJEr9fN1Jw6QWwBMNAEiICaFkFltv+bND3jYCYymJSATqib5qsmMEUAqxKgOWFrw9qbt2685e986MCOJ0dWLq1Zi1IZBxOoUHrlppvfeuPv/Yel2zYjc3W3P1OHMG4q6hEFBBQkItQ0iz4qglrQGIXOxDfNNWdduuhq86ScjgjFhYzBphCiRuZOKP5K84IuX4CaPvIUhRPVmFvIopTIlM34oulLKQRltmktIAgCIxRwBgWkcoozgDWGykSEQFlbVfUF7qo731Zb6MbKiyppUAoKg1T91Vs21SITZXTdKM6rSA4QLF0mhJJKKBlE+gUFVEaFFWYGV6vHbKdOaWwbqXZ2aBkcRcSZuqK2LLJ2CaAL9ZEjoaSHeaGSc7Zk1kqJwbtuUcWRoAiEhBOlWNBAI0TEADCKAVABJAIUafqjStPNG1CKBReUcKZZM+kpev1SRLx4IQkIDIQ3CepiWUeVNp0DIhk11mom4mJBYVSGpk04qBYBo0BIMRpiw3QAIRAVx0ya2bbpv0oq6ugkilLERG3QivPMK1Sr81Er0SGqCTn7wiSATkdaoKgBfEUjdiFawQBQpOnArSY+MIJRojgl6CXL3JCKnpO7U4EZSdLqOtBqmAHqKAqBSk0/6H4qaJqk+qZ/KXG6MasAoJhAIBlRO6sVjvTGzFQoYiRImsGaFquimc+8iKhzaLJAp7+LDBZDrIxRCQl0cAox52KT4gKcmQLx3MfT3F7Q5kZFZzvIJoCgVKGYMojRERrneDLNKEGjSQSi8xzyPnO5Y4z9EMqpicmZybI3M1OXVb/XDSHCqTrXabdb7Xan3V6wcGHWzjXPKVKHWNa1BeaxyeMRQqXJt3ujT6MVRWnqImgss+C8K7K88A4W66rqTc8cPTbWL8ter9fv9yWYRMvyrNVp+6IYHhoanlcMjQypFnAFa9QhhFAHmkKcmDTW7+zFJYGCTgxiUYwyeJkgTADNWhmBKvpTE9adETCSTrV5kAZO+UCi5fJW0WqJlt3uyaNHj+/fd3TXrlP79p04eDCcGLOpbndmJoYII0hTEOJUszzrdDrDo6N++Yol11y9dP3VSzdvWHjNqtbofKHvlV2rY0H4AAHCt/M88oggrBxNLSuyVtFWKbtjp/Y/vf/4c88f37N/bO8+HDs+OTXV6/VDqM3MU9QIEaj4POsMDclop71k8aI1axZdfc2Ka69dsmbNyNLFRZ6FUPeq/hRrhQ5FnaWWJD1Yj49bv6u5H9jHyyxP5F9fegAWTm18YtfXHty2dWvVPQVCRYwmmR9pD+ciM8de2rNz+57HHtv/xFOTLxzojo25XjlE7cBpxrLAPFV1ok6AxlEASdaljXUnXjrWenrPhH39qVxtuLNo7arV11+37vtuW7v1LUNLl0RKmKmiGeb2wM7OKMBnrt3KEevxQ4eeePTxFx58+MXndk0eOuK6ZTvQKWNu3vl5qqICp0pocz+ExSpM9DpHxZ55cR++9bRShtqdxYtGt6zbcP3W9W+9cfnGDSOL5vVD5EzNaKpi0UTFUZ6+9/52MJ+zDxDCy4wg+dTWDa/LhaNYFn1QzaTf7oVjixd/8N/+31vvvDNUpaiqan9q+uCOpx+9/4F93/rWzN59RbfbEmSFE+/hnYlGGBrPk4NG8ALYbJA8WNkUmAQREcIiYxliHSTL87UrV991543vfufa629wraKcmY7RvM72j59dxzLQzDKfFe2h/uT4czu2P/Y3Xzr8yPZw5KW8jlme+cKJqsEAgbnTS2A4q8u9DZa6hGoqdBBnxhhjHcoyBjiOjo5uXH/N7bdtffv3r9iyISsKowkgol+++zNf/n9+a01lgnI6U2e5s6bX/WuZS9Fqemr5nXf91KfvJvmypevXDaAz8zzNifSjlZ2hmz/w7tV33GiFP/j0rmfv+0b36d3W77eLovCZFxCMtMb5JYSANjYH55gPNnZ+9mcUExlApiIKhaGu6m5d2XB79Q1bbvnQBze+4x2t0ZHJfl+iZHQeEhkD6ArfLtrjx1968p7P7fjCF1/ata8ow1Ce+yzTwc3wdKZHmwyPnHGdBOdETCY0UCECCqEiShVBMPbqqqzrbGR0yY3Xbf7B2xesX1NOTO289xs7v/TVRYSnEEZ5faKvyxyg2WUvkdEZme71ZtpC77QfOs5zyMPJIKLCOa/1hfsDL/s1AoRmFA+pYeOxHwwrr91y60d+ZMvfepfrDOt0mNLIls7zef/YiYf+/PMP/eU9ky++MCI6zxWZSQCD0NG+q9fl5Tczm5oSUdHK3FQ9rRZaHlUYDlIMtWey+Hpnc18NoMsikSiAkSdGqCNFy6AQa2e1UCIRiVegc/bTv6BUwVxejRmdYH7WqdVO7n7qr//V07s+88U7fvanFt92Y6vV7k9MfPOBr9/36T+eefb5RZqNtjogNJiBpt/Tq/KyP3xgnEhEBg8uzjOiMFrhKkVp0V3eq6uXUSaaMETLoyhZK0wFcJcC1oEdEgBwwaKL7VbW8dnhRx/9o3/+zOiWjfMWLjx58NCJ/ftGyFXtloY6VAGiIEwu7SNgrDUib1ZzHaEKagLowjJDJiK+UggQBSa8RC+f2mDJYzZEV4kylTEu7LQj+dgzx2mSZavzAgwh1sGJN4jBZDCaesmsgsBHRV/OcubSUsYFKosOYFRQIIQzuUQZs2ZcTAafKidKbQUyRBPakHPilaitBmDqokBFVHB68nq5337xbsyZmCBK87nBiAmgC7PfahisoZ7H67lIasJgPcsladbq0aT9IDSclfWVjABoelZEdcnujUI5nY2Wy98AXV4+0Ot9dTkTfl8OD+GKqE1M23qSEkBJCaCkBFBSAigpKQGUlABKSgAlJYCSkhJASQmgpARQ0hsWoNkjs5ieRdKcmt0iMPcSs4rIKwtdk5JOy6m+SmWAqp5dGJOUdK75md3Q4L07zxTWauUh9DK6kHtTSJ2eWhIgal7MUdSEEeZz1wD1coDc6HxEipOmvjPNZElnuz6O4iCOHGkPzW2B/KJFRtUQTRhFhMkbSgLQ7H81Z9AaqLhw/sI5XR3NV15VB8shJhaVl/kmkqTX0AIZxEAq1ERbK1bMPYUNr1pNOG+gMCokudNJAy8oQgzCSlB3iqEVy9CcGvAygNZs3kzJlDCNzYk56dElDfZdElRG1L4ztHj9OqA5++1cgFZdc7UfnV9HUut2iEFdskFJSjiToEoXfH9y3bwVnavXY65koi5bu7a9ankZ7WVHSSQlAULRsg4Lrt2Qdeab2SvbgGjWnrfkpuu7IWRwQSkpp5jUnE5KAUThg3PL7rj1vLYKwJo7b63V+ShBkhOddA4esWY+umDlHbfgPIthWgMbbtu2YNliq2pTSasaSRgczSVQ7ZfV1dduWbRxo9UQmSPA0hDreQtXXnfb23tlBU9BSiQmAUBQVcBV8bp3vpM6zDj3gVrqWRP6lvf/WH+o7SwSqbAjCQBqD62qhUtWrH3veyJssNj1SoBUM4lce+e2JTffwilzmvJASSDYosWp3uoPvKuzZoPWJu489UAGz9qYZ7f/3Z/s1/78lUNJb6bwXQRlnY/Ou/kjHzY4jec1K6oimmtFbn3n+xbfeutk1dXkBaXoS3W6W137gQ8svvbGkia5no8JFSAo8mC+1frBj/9shep0PvH0cYJJbzbzE8s4tHjZ7T/3M4jiKZUSCOcFSCCqanW89u3vWP++D011x8Q7F92M19rFVoyJoTe8mpVQZ45wUJb9ydt++udH11/LOrhB+H7emmg4AE5MSMne90/+hS5bwZmaSkV0tKBpheNNMGeZMxHAMrI3011x81u3ffRjrIyZQJr0znlKWs+e9kKoF69Z975//MmZGuLrRf0yj24q8wmgN7xcLGrV2petuiqK+e/7xK+6kaYh2rdZm9CzZz7vXIx209/5sU0//qO9k1Pe+a7Cm0vP940ft1MMgsyf6vfe9Yv/57Jbbg8xMnP4donlcwASVQepaO//xC8t3nbnkTKqz4o6pDnsDa/KV23npsaqLT/+ka0f+2ioo6pTwMsFAzQgUYlYtUYW/chvfap91To30dNCU3L6DW5+QA7F6uSJG2/5P37ol391xiuIQS9sDg7FPp8ReTlAAubqLNr8Vet+8rd/Kyxd2Z/utcS8oVZXq7ZrZpHJJl3ZMZdEgC4WGlomrm5b/dKpFTdv+9u/+WscGhaIc3om6pLzx2CAvGJTc9N+zfVi7Dh36MlHP/MPPs6XDnNBO+/WRZDxlgLILeWHruRMD0FBpY6Qlmp96uSKm2750d/+ndaKVUFU1DnYBZ6b8PJfikANAsicm6zKlVtv+qn/+nu6YVN9YmoEVmYhiF6KHihJry1ATk289J3vnxwfX/+2d334P/7X1oqrQi96cQLEC7YPL7dABA3mggNQe8QQW95NHt7/uV/6pRcfun94dMjFLNJMkwG6kqcwuBYkq3qner0tP/4TP/TJX8HICEL06ho/2GDuwsyEzHEuB4kIKKJCIawDMh/7U3/z737jyT/8Q+/7eadjAWmR40o1PyJw6E3NtNrzf/Dj//jGn/tY1zshc2mWJU77t/LdWSAY4GA1aGBBwDQaRZx67Lznc/f8+1/p7Tk4NDxPnMRogibT1HSAH3zDmRX9M21TmLZNv2ZqwmY2vV/PmlsgcOqtCt3u+FXbtr3nX/7rFbfcHoMJRBVQNjOXg8LkAo+OmsMCzfYb5RkHnABpoKpOnDj21d/5zSc+e7d0u/PbHbi8pAijkJCmqTAF8CbWtAaFNV9pkiqNLg0upgRMBy+wkI4Rg9bBTVNzVynbpNT19EzVXrT0bR/9+bf9vb/n5g2HGJzzYqdf+u+4j5Vc+NFSNIvRNPMK7N/xrYf+y38+cP+XQzWZj3YEIzCoRWdNlzgGF5t2yiY0ESW8pbG+RB6x4tyhD2qAECIQqHMQqcow2S3mzV//gQ/c9jMfXbhxC0ozZ/Rev7f+Wt8JQCQgtIggWijA3d/88o677z785Qd4csbnmevk0TNoNNCHxoypwQWBgBkTQZfII1Yl/GxPeSrpKsKJOKvZL0tfcf6SZas/8K6bP/zjS7a8FQZWgZmYKptc82sD0Fm3HIwxqMvFAzj55LO77v2LJx+8/8hzuzA5MQQUPq/zoUK8ixSnNWgOENJ4lmeUdBG8YREJhKNkBhprJ8GqvJouq7pSV4wuXLtp81ve9c7V73n38JqNhOvTPMXJwD2S0x3+5Lu2f985QAFBAQ3egtEjes0Bi1MvPvH04YcePrp9x9E9e45PnsJ0t+j3PYzeqCLwZ/VzT7oIADVvY4SqUYMFMHQy3xlaN3rVgk0bl96xbeUd2xZvupboRJirqSbwWjkKmEHPjXJeQ4BggCAKjBBEsRJWOD2TOOiNvTRzYN+xfQf6hw9PH31xfOpkv9u3EtFiOs3zYrrPqqqa5cVQq7Nw/oLWymUjK5cuXndNsXZDMbRg4HjUiNHUSVMVLwIwQM7piE357hGSizeipJGEqKQjO19/x4jWhGCvWk54UVz4S2ASSGL2cEYMaJKUBrpU4ulEHAduEfCa7Q+VNKckfU/TaHoESQmgpARQUgIo6U2o/x9zMhZAFMaVfQAAAABJRU5ErkJggg==";

function iconResponse() {
  const bin = atob(ICON_PNG_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" }
  });
}

const MANIFEST = JSON.stringify({
  name: "The Recipe Box",
  short_name: "Recipe Box",
  start_url: "/",
  scope: "/",
  /* display_override is the standards-based way to ask for the screen with no
     system chrome at all; display stays as the fallback for anything that
     does not read it. Note this is also what Android acts on - there it will
     hide the status bar outright, clock and battery included. Drop the
     override line if that is not what you want on other devices. */
  display_override: ["fullscreen", "standalone"],
  display: "standalone",
  background_color: "#f2ede1",
  theme_color: "#f2ede1",
  icons: [{ src: "/icon.png", sizes: "192x192", type: "image/png", purpose: "any maskable" }]
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/icon.png") return iconResponse();

    if (url.pathname === "/manifest.webmanifest") {
      return new Response(MANIFEST, {
        headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=86400" }
      });
    }

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Use POST for the API." }, 405);
      }
      if (!env || !env.DB) {
        return jsonResponse({ error: "The database binding named DB is missing from this Worker." }, 500);
      }
      let body;
      try { body = await request.json(); }
      catch (e) { return jsonResponse({ error: "That request was not readable." }, 400); }
      try {
        return await handleApi(url.pathname.slice(5), body || {}, env, request);
      } catch (e) {
        if (e instanceof ApiError) return jsonResponse({ error: e.message, code: e.code, detail: e.detail }, e.status);
        return jsonResponse({ error: "Something went wrong on the server." }, 500);
      }
    }

    return new Response(APP_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};
