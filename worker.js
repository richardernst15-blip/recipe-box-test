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
.font-display{ font-family:Georgia,"Iowan Old Style","Palatino Linotype",serif; font-weight:700; }
.font-mono{ font-family:"SF Mono",Menlo,Consolas,monospace; }
.wrap{ max-width:960px; margin:0 auto; padding:0 16px 110px; }
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
  padding-bottom:env(safe-area-inset-bottom); }
.tabbar .tab{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:2px; padding:7px 0 6px; border:0; background:none; cursor:pointer;
  color:var(--ink-muted); font-size:10.5px; letter-spacing:.01em; }
.tabbar .tab span{ line-height:1.2; }
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
.cal-more{ font-size:9px; color:var(--ink-muted); padding-left:3px; }
.cal-tools{ display:flex; align-items:center; gap:8px; margin:10px 0 0; }
.sched-banner{ display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  background:#fbf0ef; border:1px solid #e3b3ae; border-radius:10px; padding:9px 12px;
  font-size:13px; color:var(--accent-dark); margin-bottom:12px; }
.sched-banner b{ font-weight:600; }

/* ---- grocery ---------------------------------------------------------- */
.groc-range{ display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin-bottom:12px; }
.groc-range .field{ flex:1; min-width:132px; margin:0; }
.groc-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.groc-entry{ display:flex; align-items:center; gap:10px; background:#fff;
  border:1px solid var(--border-light); border-radius:11px; padding:12px 13px; }
.groc-entry-main{ flex:1; min-width:0; text-align:left; border:0; background:none; cursor:pointer; padding:0; }
.groc-entry-label{ font-size:14px; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.groc-entry-sub{ font-size:12px; color:var(--ink-muted); margin-top:2px; }
/* One shopping line: tick, name and quantity, then the three controls. */
.groc-row{ display:flex; align-items:flex-start; gap:9px; background:#fff;
  border:1px solid var(--border-light); border-radius:11px; padding:10px 6px 10px 10px; }
.groc-row.groc-done .groc-name{ text-decoration:line-through; color:var(--ink-muted); }
.groc-row.groc-dragging{ opacity:.65; border-color:var(--accent); box-shadow:0 4px 14px rgba(0,0,0,.12); }
.groc-row.merge-src{ border-color:var(--accent); background:#fbf0ef; }
.groc-row.merge-target{ cursor:pointer; border-style:dashed; }
.groc-tick{ flex-shrink:0; width:22px; height:22px; margin-top:1px; border-radius:6px;
  border:1.5px solid var(--border); background:#fff; color:#fff; cursor:pointer;
  display:flex; align-items:center; justify-content:center; padding:0; }
.groc-tick.on{ background:var(--green); border-color:var(--green); }
.groc-main{ flex:1; min-width:0; }
.groc-name{ font-size:14px; line-height:1.3; }
.groc-from{ font-size:11px; color:var(--ink-muted); margin-top:1px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.groc-qty{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:5px; }
.groc-qty input{ width:66px; padding:4px 6px; font-size:12.5px; border-radius:7px;
  border:1px solid var(--border); background:var(--card-alt); text-align:right; }
.groc-unit{ font-size:12px; color:var(--ink-muted); }
.groc-alt{ font-size:11.5px; color:var(--ink-muted); }
.groc-plus{ font-size:12px; color:var(--ink-muted); padding:0 1px; }
.groc-acts{ flex-shrink:0; display:flex; align-items:center; gap:1px; }
.groc-acts button{ border:0; background:none; color:var(--ink-muted); cursor:pointer; padding:5px; }
.groc-acts button:active{ color:var(--accent); }
/* touch-action is the whole trick on iOS: without it the first finger-move
   is claimed by the scroller and the row never gets a pointermove. */
.groc-grip{ flex-shrink:0; color:var(--border); cursor:grab; padding:5px 2px;
  touch-action:none; -webkit-user-select:none; user-select:none; }
.groc-merge-hint{ background:#fbf0ef; border:1px solid #e3b3ae; border-radius:10px;
  padding:9px 12px; font-size:13px; color:var(--accent-dark); margin-bottom:10px;
  display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

/* A line you have said you do not need. Still there, still recoverable,
   plainly not part of the shop any more. */
.groc-row.groc-gone{ background:#f7f4ed; border-style:dashed; }
.groc-row.groc-gone .groc-name{ color:var(--ink-muted); }
.groc-row.groc-gone .groc-qty input{ color:var(--ink-muted); background:transparent; }
.groc-sep{ display:flex; align-items:center; gap:8px; margin:4px 2px 0;
  font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-muted); }
.groc-sep::after{ content:""; flex:1; height:1px; background:var(--border-light); }
.groc-add{ width:100%; margin-top:10px; display:flex; align-items:center; justify-content:center; gap:6px; }
/* The name of an open list is the name of the list, and tapping a title to
   change it is the thing everyone tries first. */
.title-edit{ display:flex; align-items:flex-start; gap:8px; width:100%; margin:0 0 4px;
  padding:0; border:0; background:none; color:inherit; text-align:left; cursor:pointer; }
.title-edit svg{ color:var(--border); flex-shrink:0; margin-top:7px; }
.title-edit:active h1, .title-edit:active svg{ color:var(--accent); }
.groc-counts{ display:flex; gap:10px; flex-wrap:wrap; font-size:12.5px; color:var(--ink-muted); margin:0 0 10px; }

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
.toast{ position:fixed; bottom:calc(78px + env(safe-area-inset-bottom)); left:50%; transform:translateX(-50%); background:var(--ink); color:#fff; padding:9px 16px; border-radius:9px; font-size:13.5px; z-index:100; max-width:90vw; text-align:center; }
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
.detail-marks{ display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 4px; }
.owner-pick{ text-align:left; }
.pick-list{ max-height:52vh; overflow-y:auto; margin-top:10px; }
.pick-row{ display:block; width:100%; text-align:left; font:inherit; font-size:14.5px; padding:10px 11px;
  border:1px solid var(--border-light); background:var(--card); border-radius:9px; margin-bottom:6px;
  cursor:pointer; color:inherit; }
.pick-row.on{ border-color:var(--accent); background:rgba(143,45,36,.09); font-weight:600; }
.share-row{ display:flex; align-items:center; gap:8px; padding:7px 0; }
</style>
</head>
<body>
<div id="app"></div>
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
1. Nutrition first, then estimate. Check the recipe page itself for a nutrition/macros section first. If it is there, use those numbers and set macrosPerServing.source to "site". Only calculate your own estimate from the ingredient list if the source has nothing, and in that case set source to "estimated".
2. Always give both units — convert to get whichever one the source is missing. Round sensibly (grams to whole numbers, cups to the nearest quarter).
3. Countable ingredients (eggs, onions, cloves of garlic) use "each" as the unit for both value fields, with the count as the value.
4. Split the method into genuinely separate steps, not one paragraph. Include timerMinutes whenever a step names a cook/rest/chill time; otherwise null.
5. Tags come from the fixed list at the end of this prompt. Copy each one exactly as written there, capitalization included. Do not invent a tag, do not reword one, and leave out anything that is not on the list. The words before a colon are the category path, not tags; the words after the colon are the tags.
6. Be generous. Include every tag that genuinely applies: meal types, region and flavor, effort, diet, each significant ingredient, occasion or season, and every cooking method and piece of equipment involved. Twenty or more tags is normal and welcome. They exist only to make the recipe easy to find again, so more is better.
7. Where a dish suits more than one answer, give every one. A hash eaten at breakfast and at dinner gets Breakfast and Dinner both. A stew that is a main and a soup gets both.
8. Only tag what is actually true of the recipe. A wrong tag is worse than a missing one.
9. Do not add any other fields. No id, no cookLog, no dates.
10. Output must be valid JSON on one line.

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
  camera: '<path d="M3 8h4l2-2h6l2 2h4v11H3z"/><circle cx="12" cy="13" r="3.4"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  sliders: '<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.5"/><circle cx="15" cy="16" r="2.5"/>',
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
    intro: "Read the recipe at the URL at the end of this message.",
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
    intro: "Read the recipe in the photo attached to this message. Transcribe what is written there; " +
      "do not substitute a similar recipe you already know. If part of the photo is unreadable, leave " +
      "that field empty rather than inventing it.",
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
  calDay: null,
  _calTop: null,
  schedWeekTop: null,
  calBack: 6,
  calFwd: 6,
  pendingDeleteList: null,
  pendingRenameList: null,
  daySearch: ""
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

function getActiveRecipe() { return state.recipes.find(r => r.recipeId === state.activeId) || null; }
function recipeById(id) { return state.recipes.find(r => r.recipeId === id) || null; }
function entryById(id) { return state.schedule.find(e => e.entryId === id) || null; }
function scheduleOn(key) { return state.schedule.filter(e => e.date === key); }
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
function addSeg(list, seg) {
  for (const s of list) {
    if (segKey(s) === segKey(seg)) {
      if (seg.mv != null) s.mv = (s.mv == null ? 0 : s.mv) + seg.mv;
      if (seg.cv != null) s.cv = (s.cv == null ? 0 : s.cv) + seg.cv;
      return list;
    }
  }
  list.push({ mv: seg.mv, mu: seg.mu || "", cv: seg.cv, cu: seg.cu || "" });
  return list;
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
  if (s.cv != null) bits.push(s.mv != null ? "(" + formatCustomary(s.cv, s.cu) + ")" : formatCustomary(s.cv, s.cu));
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
  state.groceryLists = data.groceryLists || [];
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
  return !!state.session && !state.loading && state.view !== "edit";
}
function TabBarHTML() {
  if (!tabsVisible()) return "";
  const cur = activeTab();
  return '<nav class="tabbar">' + TABS.map(function (t) {
    return '<button class="tab' + (t[0] === cur ? " on" : "") + '" ' +
      'aria-current="' + (t[0] === cur ? "page" : "false") + '" ' +
      'onclick="Actions.goTab(\\'' + t[0] + '\\')">' +
      icon(t[1], 22) + '<span>' + t[2] + '</span></button>';
  }).join("") + '</nav>';
}
function renderTabBar() {
  const el = document.getElementById("tabbar-root");
  if (el) el.innerHTML = TabBarHTML();
}

function visibilityPill(r, clickable) {
  const shared = r.visibility === "friends";
  const label = shared ? "Shared with friends" : privateLabel();
  const glyph = shared ? icon("globe", 12) : icon("lock", 12);
  const cls = "pill" + (shared ? " pill-shared" : "");
  if (!clickable) return '<span class="' + cls + '">' + glyph + " " + label + '</span>';
  return '<button class="' + cls + '" onclick="Actions.toggleVisibility()">' + glyph + " " + label + '</button>';
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
      '</div>' +
      '<p class="helper-text">The start and end date are the days you are <b>shopping for</b> — not the ' +
        'day you go. Everything scheduled on the calendar between them, inclusive, goes on the list.</p>' +
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

/* One shopping line. The tick is for the shop; the x is for things you have
   already got in ("1 tbsp olive oil"); the quantity is editable because half
   a bag of flour at home means half a bag on the list; the arrows fold two
   spellings of the same thing together; the dots reorder to match the aisles.  */
function GroceryRowHTML(L, item, merging) {
  const gone = !!item.removed;
  const isSrc = merging && state.groceryMergeFrom === item.id;
  /* A line you have set aside is not a thing to merge into. */
  const isTarget = merging && !isSrc && !gone;
  const qty = (item.qty || []).map(function (s, si) {
    const primary = (s.mv != null) ? s.mv : s.cv;
    const unit = (s.mv != null) ? (s.mu || "") : (s.cu || "");
    const alt = (s.mv != null && s.cv != null)
      ? '<span class="groc-alt">(' + esc(formatCustomary(s.cv, s.cu)) + ')</span>' : "";
    return (si ? '<span class="groc-plus">+</span>' : "") +
      '<input type="number" step="any" min="0" ' + (gone ? "disabled " : "") +
        'value="' + (primary == null ? "" : primary) + '" ' +
        'aria-label="Quantity for ' + esc(item.name) + '" ' +
        'onchange="Actions.setGroceryQty(\\'' + L + '\\',\\'' + item.id + '\\',' + si + ',this.value)" />' +
      (unit ? '<span class="groc-unit">' + esc(unit) + '</span>' : "") + alt;
  }).join("");
  const cls = "groc-row" + (item.checked && !gone ? " groc-done" : "") + (gone ? " groc-gone" : "") +
    (isSrc ? " merge-src" : "") + (isTarget ? " merge-target" : "");
  const rowClick = isTarget
    ? ' onclick="Actions.completeGroceryMerge(\\'' + L + '\\',\\'' + item.id + '\\')"'
    : "";
  /* Set aside: put it back, or say for certain you never wanted it. Still
     wanted: set it aside, fold it into another line, or drag it. */
  const acts = gone
    ? '<button title="Put this back on the list" onclick="event.stopPropagation(); Actions.restoreGroceryItem(\\'' +
        L + '\\',\\'' + item.id + '\\')">' + icon("undo", 15) + '</button>' +
      '<button title="Delete for good" onclick="event.stopPropagation(); Actions.purgeGroceryItem(\\'' +
        L + '\\',\\'' + item.id + '\\')">' + icon("trash", 15) + '</button>'
    : '<button title="Not needed — set aside" onclick="event.stopPropagation(); Actions.removeGroceryItem(\\'' +
        L + '\\',\\'' + item.id + '\\')">' + icon("x", 15) + '</button>' +
      '<button title="Merge with another line" onclick="event.stopPropagation(); Actions.beginGroceryMerge(\\'' +
        item.id + '\\')">' + icon("merge", 15) + '</button>' +
      '<span class="groc-grip" title="Drag to reorder" ' +
        'onpointerdown="Actions.gripDown(event,\\'' + L + '\\',\\'' + item.id + '\\')">' +
        icon("grip", 16) + '</span>';
  /* The tick is inert on a line that is not being bought. */
  const tick = gone
    ? '<span class="groc-tick" aria-hidden="true"></span>'
    : '<button class="groc-tick' + (item.checked ? " on" : "") + '" ' +
        'aria-pressed="' + (item.checked ? "true" : "false") + '" ' +
        'onclick="event.stopPropagation(); Actions.toggleGroceryCheck(\\'' + L + '\\',\\'' + item.id + '\\')">' +
        (item.checked ? icon("check", 14) : "") + '</button>';
  return '<li class="' + cls + '" data-id="' + item.id + '"' + rowClick + '>' +
    tick +
    '<div class="groc-main">' +
      '<div class="groc-name">' + esc(item.name) + '</div>' +
      ((item.from && item.from.length) ? '<div class="groc-from">' + esc(item.from.join(", ")) + '</div>' : "") +
      '<div class="groc-qty" onclick="event.stopPropagation()">' + qty + '</div>' +
    '</div>' +
    '<div class="groc-acts">' + acts + '</div>' +
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
  /* Rendered in stored order, which normalizeGroceryOrder keeps banded, with a
     caption dropped in where the band changes. The captions are not .groc-row
     elements, so the drag maths steps straight over them. */
  let body;
  if (items.length === 0) {
    body = '<div class="empty-state"><p class="title font-display">Nothing on this list</p>' +
      '<p class="sub">Either nothing was scheduled for those days, or you have taken everything off.</p></div>';
  } else {
    let seenChecked = false, seenGone = false;
    body = '<ul class="groc-list" id="groc-items">' + items.map(function (i) {
      let sep = "";
      if (i.removed && !seenGone) { seenGone = true; sep = '<li class="groc-sep">Not needed</li>'; }
      else if (!i.removed && i.checked && !seenChecked) { seenChecked = true; sep = '<li class="groc-sep">In the basket</li>'; }
      return sep + GroceryRowHTML(L, i, merging);
    }).join("") + '</ul>';
  }
  return '' +
    '<div class="wrap">' +
      '<div class="detail-top">' +
        '<button class="back-link" onclick="Actions.backToGroceries()">' + icon("chevronLeft", 18) + ' Lists</button>' +
      '</div>' +
      '<button class="title-edit" title="Rename this list" ' +
        'onclick="Actions.openRenameList(\\'' + L + '\\')">' +
        '<h1 class="detail-title font-display" style="font-size:20px;margin:0">' +
          esc(meta ? meta.label : "Shopping list") + '</h1>' +
        icon("pencil", 14) +
      '</button>' +
      '<div class="groc-counts">' +
        '<span>' + got + ' of ' + live.length + ' in the basket</span>' +
        (gone ? '<span>' + gone + ' not needed</span>' : "") +
      '</div>' +
      '<p class="helper-text">Tap a quantity to change it if you already have some at home, the x to set a ' +
        'line aside, the arrows to merge two spellings of the same thing, and the dots to drag a line into ' +
        'aisle order. Anything set aside drops to the bottom and can be put back.</p>' +
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

function CalCellHTML(key, today) {
  const d = fromYmd(key);
  const entries = scheduleOn(key);
  const shown = entries.slice(0, CAL_CHIP_MAX);
  const chips = shown.map(function (e) {
    const live = !!recipeById(e.recipeId);
    const label = live ? (recipeById(e.recipeId).title) : e.title;
    return '<button class="cal-chip' + (live ? "" : " cal-chip-orphan") + '" ' +
      'title="' + esc(label) + ' · ' + esc(String(e.servings)) + '" ' +
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
  calWeekStarts().forEach(function (ws) {
    for (let i = 0; i < 7; i++) cells += CalCellHTML(addDays(ws, i), today);
  });
  const planned = state.schedule.length;
  return '' +
    '<div class="wrap">' +
      '<div class="detail-top">' +
        '<h1 class="detail-title font-display" style="margin:0">Calendar</h1>' +
        '<button class="btn btn-sm" onclick="Actions.calToday()">Today</button>' +
      '</div>' +
      '<p class="helper-text">Recipes are scheduled from the <b>Recipes tab</b> — open one and use ' +
        'Schedule this recipe. Whatever you schedule shows up here, and its ingredients feed the ' +
        '<b>Groceries tab</b> when you build a shopping list for those days.</p>' +
      '<div class="cal-head">' + head + '</div>' +
      '<div class="cal-scroll" id="cal-scroll" onscroll="Actions.onCalScroll(this)">' +
        '<div class="cal-grid">' + cells + '</div>' +
      '</div>' +
      '<div class="cal-tools">' +
        '<span class="helper-text" style="margin:0">' +
          (planned ? planned + ' recipe' + (planned === 1 ? "" : "s") + ' on the calendar' : "Nothing scheduled yet") +
        '</span>' +
      '</div>' +
    '</div>';
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
        return '<li class="groc-entry">' +
          '<button class="groc-entry-main" onclick="Actions.openScheduled(\\'' + e.entryId + '\\')">' +
            '<div class="groc-entry-label">' + esc(r ? r.title : e.title) + '</div>' +
            '<div class="groc-entry-sub">' + esc(String(e.servings)) + ' ' +
              esc(r ? r.servings.unit : "servings") +
              (r ? "" : " · no longer in your box") + '</div>' +
          '</button>' +
          (r ? '<button class="icon-btn" title="Change the day or the servings" ' +
            'onclick="Actions.openScheduleEdit(\\'' + e.entryId + '\\')">' + icon("pencil", 15) + '</button>' : "") +
          '<button class="icon-btn" title="Unschedule" onclick="Actions.unschedule(\\'' + e.entryId + '\\')">' +
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
      '<span style="color:var(--ink-muted);flex-shrink:0">' + icon("plus", 16) + '</span>' +
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
      '<input type="text" id="friend-name" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Their username" />' +
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
    return '<p class="helper-text">Nothing new. When a friend shares a recipe, or somebody logs a cook of one of yours, it turns up here.</p>';
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

function RecipeBodyHTML(r) {
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
      '<div class="cook-col-right"><h2 class="col-title font-display">Steps</h2><ol class="step-list" style="list-style:none;padding:0;margin:0">' + stepItems + '</ol></div>' +
    '</div>' +
    (r.notes ? '<div class="notes-box"><b>Notes:</b> ' + esc(r.notes) + '</div>' : "") +
    CookLogHTML(r);
}

function DetailViewHTML(r) {
  if (!r) return '<div class="wrap"><p style="padding-top:30px">That recipe is no longer in your box.</p>' +
    '<button class="btn" onclick="Actions.backToLibrary()">Back to the recipe box</button></div>';
  const st = statsFor(r.recipeId);
  const action = r.ours
    ? '<button class="btn btn-sm" onclick="Actions.openEdit(\\'' + r.recipeId + '\\')">' + icon("pencil", 14) + ' Edit</button>'
    : "";
  /* Who and how well it went, straight under the name. */
  const credit = r.ours
    ? (r.owner === state.session.username ? "" : '<span class="owner-badge">' + icon("chain", 11) + ' ' + esc(r.owner) + '</span>')
    : '<span class="owner-badge">from ' + esc(r.household) + '</span>';
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
  /* The code carries a link to this recipe and nothing else. Scanning it
     asks its owner to be friends and queues the pin. */
  const qrBlock =
    '<div class="qr-side" style="margin:14px 0 16px">' +
      '<div class="qr-holder">' + recipeQrHTML(r.recipeId, 112) + '</div>' +
      '<div class="qr-side-text">' +
        (r.description ? '<p class="detail-desc" style="margin:0 0 6px">' + esc(r.description) + '</p>' : "") +
        '<p class="helper-text" style="margin:0">Point a friend\\'s camera here to send them this recipe.' +
        (r.ours && r.visibility !== "friends"
          ? ' It is ' + esc(privateLabel().toLowerCase()) + ' at the moment, so they will not see it until you share it with them.'
          : "") + '</p>' +
      '</div>' +
    '</div>';
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
function updateRecipeBody() {
  const el = document.getElementById("recipe-body");
  const r = getActiveRecipe();
  if (el && r) el.innerHTML = RecipeBodyHTML(r);
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
          '<button class="' + (d.visibility === "friends" ? "active" : "") + '" onclick="Actions.setDraftVisibility(\\'friends\\')">' + icon("globe", 15) + ' Shared with friends</button>' +
        '</div>' +
        (d.visibility ? "" : '<p class="req-note">Pick one before saving.</p>') +
        (d.visibility === "private" ? PrivateShareHTML(d) : "") +
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
  return '<p class="helper-text" style="margin-top:10px">Hidden from everyone except your cookbook, plus anyone you tick here.</p>' +
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
  return modalShell(editing ? "Edit this booking" : "Schedule this recipe",
    '<p class="helper-text"><b>' + esc(r.title) + '</b> — normally makes ' + base + ' ' +
      esc(r.servings.unit) + '. Change the number below and the ingredients follow.</p>' +
    SchedStripHTML(date, d.entryId || null) +
    '<div class="row2" id="sched-fields">' +
      '<div class="field"><label>Day</label>' +
        '<input type="date" id="sched-date" value="' + esc(date) + '" ' +
        'onfocus="Actions.onSchedFieldFocus()" ' +
        'onchange="Actions.setScheduleField(\\'date\\', this.value)" /></div>' +
      '<div class="field"><label>' + esc(r.servings.unit.charAt(0).toUpperCase() + r.servings.unit.slice(1)) + '</label>' +
        '<input type="number" id="sched-servings" min="0.5" step="0.5" value="' + serv + '" ' +
        'onfocus="Actions.onSchedFieldFocus()" ' +
        'onchange="Actions.setScheduleField(\\'servings\\', this.value)" /></div>' +
    '</div>' +
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
      '<button class="' + (state.importVisibility === "friends" ? "active" : "") + '" onclick="Actions.setImportVisibility(\\'friends\\')">' + icon("globe", 15) + ' Shared with friends</button>' +
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
function ConfirmIntentModalHTML() {
  const c = state.intent || {};
  if (c.type === "friend") {
    return modalShell("Add a friend",
      (state.modalError ? '<div class="modal-error">' + esc(state.modalError) + '</div>' : "") +
      '<p style="margin:0 0 14px">Send <b>' + esc(c.name) + '</b> a friend request?</p>' +
      '<p class="helper-text">They have to accept before either of you sees the other\\'s shared recipes. ' +
      'Friendships link whole cookbooks, so anyone sharing theirs comes with them.</p>' +
      '<div style="display:flex; gap:8px; margin-top:16px">' +
        '<button class="btn btn-primary" style="flex:1" ' + (state.busy ? "disabled" : "") +
          ' onclick="Actions.runIntent()">' + icon("userPlus", 15) + ' Send request</button>' +
        '<button class="btn" onclick="Actions.dismissIntent()">Not now</button>' +
      '</div>');
  }
  const p = c.preview || {};
  return modalShell("A recipe was shared with you",
    (state.modalError ? '<div class="modal-error">' + esc(state.modalError) + '</div>' : "") +
    (p.title
      ? '<p style="margin:0 0 6px"><b>' + esc(p.title) + '</b></p>' +
        '<p class="helper-text" style="margin:0 0 14px">From ' + esc(p.household || p.owner || "another cookbook") + '</p>'
      : '<p style="margin:0 0 14px">Someone shared a recipe with you.</p>') +
    (p.mine
      ? '<p class="helper-text">This one is already in your own cookbook.</p>'
      : p.friends
        ? '<p class="helper-text">You are already friends, so this will pin it to your cookbook and open it. Pinning is a live view of their recipe, not a copy - their edits show, and it goes if they delete it.</p>'
        : '<p class="helper-text">To see it you need to be friends. This sends ' +
          esc(p.owner || "them") + ' a friend request and remembers the recipe - it pins itself to your cookbook the moment they accept.' +
          (p.visibility && p.visibility !== "friends"
            ? ' Note it is private at the moment, so they will also need to share it with you.' : "") +
          '</p>') +
    '<div style="display:flex; gap:8px; margin-top:16px">' +
      '<button class="btn btn-primary" style="flex:1" ' + (state.busy ? "disabled" : "") +
        ' onclick="Actions.runIntent()">' +
        (p.mine ? "Open it" : p.friends ? "Pin and open" : icon("userPlus", 15) + " Ask and save it") + '</button>' +
      '<button class="btn" onclick="Actions.dismissIntent()">Not now</button>' +
    '</div>');
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

function setScrollLock(want) {
  const b = document.body;
  if (!b) return;
  setChromeTint(!!want);
  if (want) {
    /* Re-measured on the way in, then kept current by the listeners in the
       init block for as long as the modal is up. */
    syncViewportVars();
    b.setAttribute("data-scroll-lock", "1");
  } else {
    b.removeAttribute("data-scroll-lock");
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
  else if (state.modal === "owner") root.innerHTML = OwnerModalHTML();
  else if (state.modal === "filters") { root.innerHTML = FiltersModalHTML(); updateFilterScrollHint(); }
  else if (state.modal === "actions") root.innerHTML = ActionsModalHTML();
  else if (state.modal === "schedule") root.innerHTML = ScheduleModalHTML();
  else if (state.modal === "calDay") root.innerHTML = CalDayModalHTML();
  else if (state.modal === "confirmDeleteList") root.innerHTML = ConfirmDeleteListModalHTML();
  else if (state.modal === "addGroceryItem") root.innerHTML = AddGroceryItemModalHTML();
  else if (state.modal === "renameList") root.innerHTML = RenameListModalHTML();
  else if (state.modal === "conflict") root.innerHTML = ConflictModalHTML();
  else if (state.modal === "locked") root.innerHTML = LockedModalHTML();
}

/* ====================================================================== */
/* Main render                                                             */
/* ====================================================================== */
function renderApp() {
  const app = document.getElementById("app");
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
Actions.copyAppUrl = async function() {
  const url = appUrl();
  try { await navigator.clipboard.writeText(url); toast("Link copied"); }
  catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy");
      document.body.removeChild(ta); toast("Link copied");
    } catch (e2) { toast("Couldn't copy - select the link and copy it manually"); }
  }
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
Actions.beginIntent = async function(intent) {
  if (!intent) return;
  if (!state.session) { stashIntent(intent); return; }
  state.intent = intent;
  state.modalError = "";
  if (intent.type === "recipe") {
    try {
      const p = await API("recipe/claim", { recipeId: intent.recipeId, preview: true });
      state.intent.preview = p;
    } catch (e) {
      toast(e.message);
      state.intent = null;
      return;
    }
  }
  Actions.openModal("confirmIntent");
};
Actions.dismissIntent = function() {
  state.intent = null;
  Actions.closeModal();
};
Actions.runIntent = async function() {
  const c = state.intent;
  if (!c || state.busy) return;
  state.busy = true;
  renderModal();
  try {
    if (c.type === "friend") {
      const res = await API("friend/request", { name: c.name });
      state.intent = null;
      state.modal = null;
      await refreshLibrary(false);
      toast(res.accepted
        ? "You are now linked with " + res.username
        : "Request sent to " + res.username + " — you will see their shared recipes once they accept");
      return;
    }
    const res = await API("recipe/claim", { recipeId: c.recipeId });
    state.intent = null;
    state.modal = null;
    await refreshLibrary(false);
    if (res.recipeId && state.recipes.some(function (r) { return r.recipeId === res.recipeId; })) {
      state._showAllLogs = false;
      Actions.openDetail(res.recipeId);
      toast(res.pinned ? "Pinned to your cookbook" : "Opened");
      return;
    }
    renderApp();
    toast(res.requested
      ? "Asked " + (res.owner || "them") + " to be friends — the recipe pins itself when they accept"
      : "Saved. It will appear once they share it with you.");
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
  if (!d.visibility) { toast("Choose " + privateLabel() + " or Shared with friends first"); return; }
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
    if (d.visibility === "private") {
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
Actions.toggleVisibility = async function() {
  const r = getActiveRecipe();
  if (!r || !r.ours) return;
  const next = r.visibility === "friends" ? "private" : "friends";
  try {
    await API("recipe/visibility", { recipeId: r.recipeId, visibility: next });
    await refreshLibrary(false);
    setWatch(r.recipeId);
    toast(next === "friends" ? "Shared with your friends" : "Now " + privateLabel().toLowerCase());
  } catch (e) { toast(e.message); }
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
  calWeekStarts().forEach(function (ws) {
    for (let i = 0; i < 7; i++) cells += CalCellHTML(addDays(ws, i), today);
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
  renderApp();
};
Actions.createGroceryList = async function() {
  const rng = state.groceryRange;
  if (!rng.start || !rng.end) { toast("Pick both dates first"); return; }
  if (rng.start > rng.end) { toast("The last day is before the first one"); return; }
  const items = buildGroceryItems(rng.start, rng.end);
  if (!items.length && !confirm("Nothing is scheduled for those days. Build an empty list anyway?")) return;
  /* Named where the local clock is, since the server's idea of the hour is
     not the one the person was standing in when they made it. */
  const now = new Date();
  const label = slashDate(rng.start) + " - " + slashDate(rng.end) + " made at " +
    DOW[now.getDay()] + ", " + MON[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear() + ", " +
    now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
/* #app is the scroller, and renderApp replaces everything inside it, so the
   scroll position goes with it. Ticking the last thing on a long list and
   being thrown back to the top is not a way anyone can shop, hence this:
   hold the position across the repaint. */
function renderKeepingScroll() {
  const before = document.getElementById("app");
  const at = before ? before.scrollTop : 0;
  renderApp();
  const after = document.getElementById("app");
  if (after) after.scrollTop = at;
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
  state.groceryItems[listId] = normalizeGroceryOrder(groceryItemsFor(listId).map(function (i) {
    return i.id === itemId ? Object.assign({}, i, { removed: true, checked: false }) : i;
  }));
  if (state.groceryMergeFrom === itemId) state.groceryMergeFrom = null;
  saveGroceryItems(listId);
  renderKeepingScroll();
};
Actions.restoreGroceryItem = function(listId, itemId) {
  state.groceryItems[listId] = normalizeGroceryOrder(groceryItemsFor(listId).map(function (i) {
    return i.id === itemId ? Object.assign({}, i, { removed: false }) : i;
  }));
  saveGroceryItems(listId);
  renderKeepingScroll();
};
/* The only irreversible one, and it is deliberately two steps: a line has to
   be set aside first, so this button is never next to a line still in play. */
Actions.purgeGroceryItem = function(listId, itemId) {
  state.groceryItems[listId] = groceryItemsFor(listId).filter(i => i.id !== itemId);
  saveGroceryItems(listId);
  renderKeepingScroll();
};
/* Editing the number you can see. Where a line carries both units, the one in
   brackets is moved by the same proportion rather than left behind saying
   something different from the number next to it. */
Actions.setGroceryQty = function(listId, itemId, segIdx, raw) {
  const n = parseFloat(raw);
  state.groceryItems[listId] = groceryItemsFor(listId).map(function (i) {
    if (i.id !== itemId) return i;
    const qty = i.qty.map(function (s, si) {
      if (si !== segIdx) return s;
      const next = { mv: s.mv, mu: s.mu, cv: s.cv, cu: s.cu };
      const val = (isNaN(n) || n < 0) ? null : n;
      if (s.mv != null) {
        const ratio = (s.mv > 0 && val != null) ? (val / s.mv) : null;
        next.mv = val;
        if (next.cv != null && ratio != null) next.cv = Math.round(next.cv * ratio * 1000) / 1000;
      } else {
        next.cv = val;
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

Actions.beginGroceryMerge = function(itemId) {
  const items = groceryItemsFor(state.activeListId);
  if (items.length < 2) { toast("There is nothing to merge this with"); return; }
  state.groceryMergeFrom = itemId;
  renderKeepingScroll();
};
Actions.cancelGroceryMerge = function() { state.groceryMergeFrom = null; renderKeepingScroll(); };
Actions.completeGroceryMerge = function(listId, targetId) {
  const fromId = state.groceryMergeFrom;
  state.groceryMergeFrom = null;
  if (!fromId || fromId === targetId) { renderKeepingScroll(); return; }
  const before = groceryItemsFor(listId);
  const after = normalizeGroceryOrder(mergeGroceryItems(before, fromId, targetId));
  state.groceryItems[listId] = after;
  const kept = after.filter(i => i.id === targetId)[0];
  saveGroceryItems(listId);
  renderKeepingScroll();
  if (kept) toast("Merged into " + kept.name);
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
  row.classList.add("groc-dragging");
  const onMove = function (e) {
    if (e.preventDefault) e.preventDefault();
    const y = (e.clientY != null) ? e.clientY
      : (e.touches && e.touches[0] ? e.touches[0].clientY : null);
    if (y == null) return;
    const others = Array.prototype.slice.call(ul.querySelectorAll(".groc-row"))
      .filter(function (n) { return n !== row; });
    let before = null;
    for (const n of others) {
      const b = n.getBoundingClientRect();
      if (y < b.top + b.height / 2) { before = n; break; }
    }
    if (before) ul.insertBefore(row, before);
    else ul.appendChild(row);
  };
  const onUp = function () {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    row.classList.remove("groc-dragging");
    const order = Array.prototype.slice.call(ul.querySelectorAll(".groc-row"));
    const toIndex = order.indexOf(row);
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

(async function init() {
  const scanned = readIntentFromUrl();
  state.session = loadSession();
  if (!state.session) {
    if (scanned) { stashIntent(scanned); state._arrivedByScan = true; }
    state.loading = false;
    renderApp();
    return;
  }
  await refreshLibrary(true);
  /* A code scanned just now wins over one left over from an abandoned visit. */
  const intent = scanned || takeStashedIntent();
  if (intent) await Actions.beginIntent(intent);
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

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,19}$/;
const COOKBOOK_RE = /^[A-Z0-9]{10}$/;
const VISIBILITIES = ["private", "friends"];
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
async function loadRecipeForReader(env, me, recipeId) {
  const row = await env.DB.prepare(
    "SELECT recipe_id, cookbook_id, owner_username, owner_lc, visibility, data, created_at, updated_at, updated_by, locked_by, locked_at " +
    "FROM recipes WHERE recipe_id = ?"
  ).bind(recipeId).first();
  if (!row) throw new ApiError(404, "That recipe is no longer there.");
  if (row.cookbook_id === me.cookbookId) return { row, ours: true };
  const friendCbs = await friendCookbooks(env, me.cookbookId);
  const linked = friendCbs.indexOf(row.cookbook_id) >= 0;
  if (!linked || row.visibility !== "friends") throw new ApiError(403, "That recipe isn't shared with you.");
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
  "CREATE INDEX IF NOT EXISTS idx_glists_cookbook ON grocery_lists(cookbook_id, created_at)"
];
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  for (const sql of LATER_TABLES) await env.DB.prepare(sql).run();
  schemaReady = true;
}

const MARK_KINDS = ["pin", "star", "later"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SCHEDULE_ENTRIES = 2000;
const MAX_GROCERY_LISTS = 200;
const MAX_GROCERY_ITEMS = 400;
const MAX_GROCERY_SEGMENTS = 8;

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
  const handed = await env.DB.prepare(
    "SELECT recipe_id FROM recipe_shares WHERE recipe_id = ? AND cookbook_id = ?"
  ).bind(recipeId, cookbookId).first();
  if (handed) return true;
  if (row.visibility !== "friends") return false;
  const friends = await friendCookbooks(env, cookbookId);
  return friends.indexOf(row.cookbook_id) >= 0;
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

/* Is a recipe actually readable by this cookbook? Shared with friends and
   linked, or handed over individually. Mirrors what recipe/mark allows. */
async function pinIsAllowed(env, cookbookId, recipeId) {
  const row = await env.DB.prepare(
    "SELECT cookbook_id, visibility FROM recipes WHERE recipe_id = ?"
  ).bind(recipeId).first();
  if (!row) return false;
  if (row.cookbook_id === cookbookId) return false;      /* already theirs */
  const handed = await env.DB.prepare(
    "SELECT recipe_id FROM recipe_shares WHERE recipe_id = ? AND cookbook_id = ?"
  ).bind(recipeId, cookbookId).first();
  if (handed) return true;
  if (row.visibility !== "friends") return false;
  const friends = await friendCookbooks(env, cookbookId);
  return friends.indexOf(row.cookbook_id) >= 0;
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

/* The friendship half of a scanned link. Same rules as friend/request, but
   reached with a cookbook rather than a username, and it reports back what
   it found rather than throwing at the caller. */
async function ensureFriendLink(env, me, theirCb) {
  if (theirCb === me.cookbookId) return { already: true };
  const now = new Date().toISOString();
  const rows = (await env.DB.prepare(
    "SELECT requester_cb, addressee_cb, status FROM friendships " +
    "WHERE (requester_cb = ? AND addressee_cb = ?) OR (requester_cb = ? AND addressee_cb = ?)"
  ).bind(me.cookbookId, theirCb, theirCb, me.cookbookId).all()).results || [];
  for (const row of rows) {
    if (row.status === "accepted") return { accepted: true };
    if (row.status === "pending" && row.requester_cb === me.cookbookId) return { requested: true };
    if (row.status === "pending" && row.requester_cb === theirCb) {
      /* They had already asked us, so scanning their code answers it. */
      await env.DB.prepare(
        "UPDATE friendships SET status = 'accepted', responded_by = ?, updated_at = ? " +
        "WHERE requester_cb = ? AND addressee_cb = ?"
      ).bind(me.username, now, theirCb, me.cookbookId).run();
      await resolvePendingPins(env, me.cookbookId, theirCb);
      return { accepted: true };
    }
    /* We were turned down once; nothing about that is worth spelling out. */
    if (row.status === "declined" && row.requester_cb === me.cookbookId) return { blocked: true };
    if (row.status === "declined" && row.requester_cb === theirCb) {
      await env.DB.prepare("DELETE FROM friendships WHERE requester_cb = ? AND addressee_cb = ?")
        .bind(theirCb, me.cookbookId).run();
    }
  }
  await env.DB.prepare(
    "INSERT INTO friendships (requester_cb, addressee_cb, status, requested_by, created_at, updated_at) " +
    "VALUES (?, ?, 'pending', ?, ?, ?)"
  ).bind(me.cookbookId, theirCb, me.username, now, now).run();
  return { requested: true };
}

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

    const memberMap = await membersOf(env, [me.cookbookId].concat(
      friendCbs,
      pendingIn.map(r => r.requester_cb),
      pendingOut.map(r => r.addressee_cb),
      declinedRows.map(r => r.requester_cb)
    ));

    const labelFor = {};
    labelFor[me.cookbookId] = householdLabel(memberMap[me.cookbookId] || [me.username]);
    for (const cb of friendCbs) labelFor[cb] = householdLabel(memberMap[cb] || []);

    let sql = "SELECT recipe_id, cookbook_id, owner_username, visibility, data, created_at, updated_at, updated_by " +
      "FROM recipes WHERE cookbook_id = ?";
    const binds = [me.cookbookId];
    if (friendCbs.length) {
      sql += " OR (visibility = 'friends' AND cookbook_id IN (" + placeholders(friendCbs.length) + "))";
      binds.push(...friendCbs);
    }
    /* A private recipe someone chose to share with this cookbook specifically. */
    sql += " OR recipe_id IN (SELECT recipe_id FROM recipe_shares WHERE cookbook_id = ?)";
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
      groceryLists,
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
    const friendCbs = await friendCookbooks(env, me.cookbookId);
    const visible = await env.DB.prepare(
      "SELECT cookbook_id, visibility FROM recipes WHERE recipe_id = ?"
    ).bind(recipeId).first();
    if (!visible) throw new ApiError(404, "That recipe is gone.");
    const mine = visible.cookbook_id === me.cookbookId;
    const shared = visible.visibility === "friends" && friendCbs.indexOf(visible.cookbook_id) >= 0;
    const handed = !!(await env.DB.prepare(
      "SELECT recipe_id FROM recipe_shares WHERE recipe_id = ? AND cookbook_id = ?"
    ).bind(recipeId, me.cookbookId).first());
    if (!mine && !shared && !handed) throw new ApiError(403, "That recipe is not yours to mark.");
    if (kind === "pin" && mine) throw new ApiError(400, "That one is already in your cookbook.");

    if (body.on === false) {
      await env.DB.prepare(
        "DELETE FROM recipe_marks WHERE cookbook_id = ? AND recipe_id = ? AND kind = ?"
      ).bind(me.cookbookId, recipeId, kind).run();
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
    await env.DB.prepare(
      "UPDATE schedule_entries SET on_date = ?, servings = ? WHERE entry_id = ? AND cookbook_id = ?"
    ).bind(date, servings, entryId, me.cookbookId).run();
    return jsonResponse({ entryId, date, servings });
  }

  if (route === "schedule/remove") {
    const entryId = cleanString(body.entryId, 64);
    await env.DB.prepare(
      "DELETE FROM schedule_entries WHERE entry_id = ? AND cookbook_id = ?"
    ).bind(entryId, me.cookbookId).run();
    return jsonResponse({ entryId, removed: true });
  }

  /* ---- shopping lists ----
     The list arrives already added up: the client knows the scheduled
     portions and the unit rules, and doing the arithmetic twice in two
     languages would only be two places for it to disagree. The server's job
     is to check the shape, cap the size and keep it. */
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
    if (!visibility) throw new ApiError(400, "Choose private or shared with friends.");
    const res = await env.DB.prepare(
      "UPDATE recipes SET visibility = ?, updated_at = ?, updated_by = ? WHERE recipe_id = ? AND cookbook_id = ?"
    ).bind(visibility, new Date().toISOString(), me.username, String(body.recipeId || ""), me.cookbookId).run();
    if (!res.meta || res.meta.changes === 0) throw new ApiError(403, "You can only change recipes in your own cookbook.");
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
      env.DB.prepare("DELETE FROM recipes WHERE recipe_id = ?").bind(recipeId)
    ]);
    return jsonResponse({ ok: true });
  }

  /* ---- a scanned recipe code ----
     Two passes. preview answers "what is this and what will happen", so the
     app can ask before acting in somebody's name; the real call then does
     whichever of the three things applies: open it, pin it, or ask to be
     friends and remember the pin for when they say yes. */
  if (route === "recipe/claim") {
    const recipeId = cleanString(body.recipeId, 64);
    const row = await env.DB.prepare(
      "SELECT recipe_id, cookbook_id, owner_username, visibility, title FROM recipes WHERE recipe_id = ?"
    ).bind(recipeId).first();
    if (!row) throw new ApiError(404, "That link points at a recipe that is no longer there.");

    const mine = row.cookbook_id === me.cookbookId;
    const friendCbs = await friendCookbooks(env, me.cookbookId);
    const linked = friendCbs.indexOf(row.cookbook_id) >= 0;
    const map = await membersOf(env, [row.cookbook_id]);
    const household = householdLabel(map[row.cookbook_id] || [row.owner_username]);

    if (body.preview) {
      return jsonResponse({
        recipeId, title: row.title, owner: row.owner_username, household,
        visibility: row.visibility, mine, friends: linked,
        canSee: mine || (await pinIsAllowed(env, me.cookbookId, recipeId))
      });
    }

    if (mine) return jsonResponse({ recipeId, mine: true, owner: row.owner_username });

    if (await pinIsAllowed(env, me.cookbookId, recipeId)) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO recipe_marks (cookbook_id, recipe_id, kind, created_by, created_at) " +
        "VALUES (?, ?, 'pin', ?, ?)"
      ).bind(me.cookbookId, recipeId, me.username, new Date().toISOString()).run();
      return jsonResponse({ recipeId, pinned: true, owner: row.owner_username });
    }

    /* Not visible yet. Ask, and keep the wish. */
    await throttleGuard(env, ["cb:" + me.cookbookId, "ip:" + ip]);
    const link = await ensureFriendLink(env, me, row.cookbook_id);
    if (link.blocked) throw new ApiError(403, "That recipe cannot be added.");
    await env.DB.prepare(
      "INSERT OR IGNORE INTO pending_pins (cookbook_id, recipe_id, created_at) VALUES (?, ?, ?)"
    ).bind(me.cookbookId, recipeId, new Date().toISOString()).run();
    /* Accepting an outstanding request can make it visible straight away. */
    if (link.accepted) await resolvePendingPins(env, me.cookbookId, row.cookbook_id);
    const nowVisible = await pinIsAllowed(env, me.cookbookId, recipeId);
    return jsonResponse({
      recipeId: nowVisible ? recipeId : null,
      pinned: nowVisible, requested: !nowVisible,
      owner: row.owner_username, household,
      accepted: !!link.accepted,
      needsSharing: row.visibility !== "friends"
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

const ICON_PNG_B64 = "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";

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
