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
.header{ display:flex; align-items:center; gap:12px; padding:26px 0 18px; }
.header h1{ font-size:26px; margin:0; }
.header p{ margin:2px 0 0; font-size:13px; color:var(--ink-muted); }
.header .icon-wrap{ color:var(--accent); flex-shrink:0; }
.header-btns{ margin-left:auto; display:flex; gap:8px; align-items:center; }
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

/* toast / loading */
.toast{ position:fixed; bottom:22px; left:50%; transform:translateX(-50%); background:var(--ink); color:#fff; padding:9px 16px; border-radius:9px; font-size:13.5px; z-index:100; max-width:90vw; text-align:center; }
.loading{ display:flex; align-items:center; justify-content:center; height:75vh; color:var(--ink-muted); font-size:14.5px; }

::-webkit-scrollbar{ width:8px; height:8px; }
::-webkit-scrollbar-thumb{ background:var(--border); border-radius:8px; }

.search-wrap { display:flex; gap:8px; align-items:center; }
.search-wrap input { flex:1; }
.search-filter { flex-shrink:0; display:flex; align-items:center; gap:5px; }
.search-filter.on { background:var(--accent); color:#fff; border-color:var(--accent); }
.fcount { display:inline-block; flex-shrink:0; min-width:17px; padding:0 5px; border-radius:9px; background:var(--accent);
  color:#fff; font-size:11px; line-height:17px; text-align:center; margin-left:6px; }
/* Still occupies its slot, so a row is the same height counted or not. */
.fcount.zero { visibility:hidden; }
.search-filter.on .fcount { background:#fff; color:var(--accent); }
.chip-clear { border-style:dashed; }
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
  chain: '<path d="M10 13.5a4 4 0 0 0 5.7.4l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.6 1.6"/><path d="M14 10.5a4 4 0 0 0-5.7-.4l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.6-1.6"/>'
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
    label: "URL to Recipe", icon: "link",
    intro: "Read the recipe at the URL at the end of this message.",
    tail: "Recipe to convert:" + String.fromCharCode(10)
  },
  photo: {
    label: "Photo to Recipe", icon: "camera",
    intro: "Read the recipe in the photo attached to this message. Transcribe what is written there; " +
      "do not substitute a similar recipe you already know. If part of the photo is unreadable, leave " +
      "that field empty rather than inventing it.",
    tail: "Recipe to convert: the attached photo."
  },
  chat: {
    label: "Chat to Recipe", icon: "chat",
    intro: "Use the recipe we have worked out in this conversation. Do not fetch anything and do not " +
      "start over; convert what we already agreed on, including any changes I asked for along the way.",
    tail: "Recipe to convert: the recipe from our conversation above."
  }
};

function buildImportPrompt(mode, url) {
  const src = IMPORT_SOURCES[mode] || IMPORT_SOURCES.url;
  return document.getElementById("import-prompt-template").textContent
    .replace("{{SOURCE}}", src.intro)
    .replace("{{TAG_LIST}}", tagVocabularyText())
    .replace("{{TAIL}}", src.tail) + (mode === "url" ? (url || "") : "");
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
  ownerFilter: "all",
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
  logRating: 0,
  importParsed: [],
  importErrors: [],
  importVisibility: "",
  importFileName: null,
  urlToRecipe: { mode: "url", url: "", prompt: "", generated: false },
  busy: false,
  _tagList: [],
  _showAllLogs: false
};

function getActiveRecipe() { return state.recipes.find(r => r.recipeId === state.activeId) || null; }
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
      AppLinkFieldHTML("Send this to a friend so they can set up their own recipe box. It is safe to share with anyone - it carries nothing about your account.") +
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
var QR_BITS = "111111100100111011111101001111111100000100010011101001010101000001101110101000010011100100101011101101110101000001010011000001011101101110101000000100100101001011101100000101011110111101110001000001111111101010101010101010101111111000000001111101100000110000000000101111100001111101000000001111100010000001010001010111001001101101001000111111000100100010010010100001010010111101000010110110011110101000110000000100100101110111010011000000100101111001001011001011010001101000101000110110111010010101110011001000010111110011111100010000100111000011011010110111001111010011000001011111001011101111001011110001011111000010000110100000001011100101111111001101111110000111110111110110011110110111000101110000001010100100101011001101100110111111001110101000100111010100001000100010100000101001101101111010111110001101000011111110011000000001110011010010100100010111111111100101100100100101101010100100000101010011110000111100011100101110101011011100110100111111010101110101001000110001011110011001101110101001111001110011101101000100000100100000010111110000011100111111101000101001011010111101010";
/* The share QR is fixed: it points at this app, nothing account-specific,
   so it is safe to show anyone. 33x33 modules, run-length drawn. */
function QRSvgHTML(px) {
  var n = 33, q = 2, span = n + q * 2, rects = "";
  for (var y = 0; y < n; y++) {
    var x = 0;
    while (x < n) {
      if (QR_BITS.charCodeAt(y * n + x) === 49) {
        var w = 1;
        while (x + w < n && QR_BITS.charCodeAt(y * n + x + w) === 49) w++;
        rects += '<rect x="' + (x + q) + '" y="' + (y + q) + '" width="' + w + '" height="1"/>';
        x += w;
      } else x++;
    }
  }
  return '<svg viewBox="0 0 ' + span + ' ' + span + '" width="' + px + '" height="' + px + '" shape-rendering="crispEdges" role="img" aria-label="QR code linking to The Recipe Box">' +
    '<rect width="' + span + '" height="' + span + '" fill="#fff"/><g fill="#111">' + rects + '</g></svg>';
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
        '<span class="mark-row">' + MarkButtonsHTML(r, false) + '</span>' +
      '</div>' +
    '</div>';
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
      : '<div class="empty-state"><p class="title font-display">Nothing matches</p><p class="sub">Try a different search, or clear the tag and cook filters.</p></div>';
  } else {
    body = '<div class="grid-recipes">' + results.map(RecipeCardHTML).join("") + '</div>';
  }
  return (state._tagList.length ? '<div class="chips">' + chips + '</div>' : "") + body;
}

function LibraryViewHTML() {
  const pending = state.incoming.length;
  const sortOptions = [["newest", "Newest first"], ["oldest", "Oldest first"], ["cooked", "Most cooked"],
    ["rated", "Highest rated"], ["az", "Title A–Z"], ["za", "Title Z–A"]]
    .map(o => '<option value="' + o[0] + '"' + (state.sort === o[0] ? " selected" : "") + '>' + o[1] + '</option>').join("");
  return '' +
    '<div class="wrap">' +
      '<div class="header"><span class="icon-wrap">' + icon("book", 30) + '</span>' +
        '<div><h1 class="font-display">The Recipe Box</h1>' +
          '<p>' + state.recipes.length + ' recipe' + (state.recipes.length === 1 ? "" : "s") + ' on the shelf · ' + esc(state.session.username) + '</p></div>' +
        '<div class="header-btns">' +
          '<button class="btn bell" onclick="Actions.openFriends()">' + icon("users", 16) +
            (pending ? '<span class="dot-badge">' + pending + '</span>' : "") + '</button>' +
          '<button class="btn" onclick="Actions.openModal(\\'actions\\')">Actions</button>' +
        '</div>' +
      '</div>' +
      '<div class="search-wrap"><span class="icon">' + icon("search", 18) + '</span>' +
        '<input id="search-input" type="text" placeholder="Search recipes, ingredients, tags..." value="' + esc(state.search) + '" oninput="Actions.onSearchInput(this.value)" />' +
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
function updateLibraryChrome() { updateResultsSection(); updateFilterButton(); }

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

  return '' +
    '<div class="wrap">' +
      '<div class="detail-top">' +
        '<button class="back-link" onclick="Actions.backToLibrary()">' + icon("chevronLeft", 18) + ' Recipe box</button>' +
      '</div>' +
      '<h1 class="detail-title font-display" style="font-size:26px">Friends</h1>' +
      '<p class="helper-text">Friendships link whole cookbooks. Add one person and you are linked to everyone who shares their cookbook, and they to everyone in yours. Recipes set to ' +
        esc(privateLabel()) + ' stay hidden either way.</p>' +
      '<div class="add-friend-row">' +
        '<input type="text" id="friend-name" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Their username" />' +
        '<button class="btn btn-primary" onclick="Actions.sendFriendRequest()">' + icon("userPlus", 16) + ' Add</button>' +
      '</div>' +
      (mates ? '<div class="section-label">In your cookbook</div>' + mates : "") +
      '<div class="section-label">Requests for you</div>' + incoming +
      '<div class="section-label">Your friends</div>' + friends +
      (outgoing ? '<div class="section-label">Requests you sent</div>' + outgoing : "") +
      (declined ? '<div class="section-label">Declined</div>' + declined : "") +
      '<div class="section-label">Share the app</div>' +
      '<div style="display:flex;gap:14px;align-items:center;background:var(--card);border-radius:12px;padding:14px">' +
        '<div style="flex-shrink:0;line-height:0">' + QRSvgHTML(120) + '</div>' +
        '<p class="helper-text" style="margin:0">Have them point a camera here to open The Recipe Box. They make their own cookbook, then you add each other by username.</p>' +
      '</div>' +
    '</div>';
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
  const tags = r.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join(" ");
  const action = r.ours
    ? '<button class="btn btn-sm" onclick="Actions.openEdit(\\'' + r.recipeId + '\\')">' + icon("pencil", 14) + ' Edit</button>'
    : "";
  const markRow = '<div class="detail-marks">' + MarkButtonsHTML(r, true) + '</div>';
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
      markRow +
      (r.description ? '<p class="detail-desc">' + esc(r.description) + '</p>' : "") +
      '<div class="detail-meta">' +
        (r.ours ? visibilityPill(r, true) : "") +
        (r.ours
          ? (r.owner === state.session.username ? "" : '<span class="owner-badge">' + icon("chain", 11) + ' ' + esc(r.owner) + '</span>')
          : '<span class="owner-badge">from ' + esc(r.household) + '</span>') +
        tags + (r.tags.length ? '<span class="dot">·</span>' : "") + ratingHTML(st.avg, st.count) +
        (st.count ? '<span class="cooked-count">cooked ' + st.count + '×</span>' : "") +
      '</div>' +
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
            ? '<button class="btn btn-sm" onclick="Actions.openImportPrompt(\\'url\\')">' + icon("link", 14) + ' URL</button>' +
              '<button class="btn btn-sm" onclick="Actions.openImportPrompt(\\'photo\\')">' + icon("camera", 14) + ' Photo</button>' +
              '<button class="btn btn-sm" onclick="Actions.openImportPrompt(\\'chat\\')">' + icon("chat", 14) + ' Chat</button>'
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
function AppLinkFieldHTML(note) {
  return '<div class="field"><label>App link</label>' +
    '<div class="code-box font-mono" style="word-break:break-all">' + esc(appUrl()) + '</div>' +
    '<button class="btn btn-sm btn-block" onclick="Actions.copyAppUrl()">' + icon("copy", 14) + ' Copy link</button>' +
    (note ? '<p class="helper-text">' + note + '</p>' : "") +
  '</div>';
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
  const step1 = u.mode === "url"
    ? '<div class="step-label">1. Paste the recipe URL</div>' +
      '<input type="url" id="utr-url" placeholder="https://..." value="' + esc(u.url) + '" style="width:100%; padding:9px 10px; border-radius:8px; border:1px solid var(--border); font-size:14.5px" />'
    : '<div class="step-label">1. Get the prompt</div>' +
      '<p class="helper-text">' + (u.mode === "photo"
        ? "Copy this prompt into Claude, ChatGPT or Grok and attach your photo of the recipe in the same message."
        : "Copy this prompt into the conversation where you have been working out the recipe, as your next message.") +
      '</p>';
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
    '<div class="field"><label>Add to your home screen</label>' +
      '<p class="helper-text"><b>iPhone or iPad:</b> open the app link in Safari, tap the Share button, then Add to Home Screen.<br>' +
      '<b>Android:</b> open the app link in Chrome, tap the three-dot menu, then Install app or Add to Home screen.</p></div>' +
    '<div class="warn-box">Anyone with this Cookbook ID can read, edit and delete every recipe in it, and inherits every friendship it has. Give it only to someone you cook with, or use it to open this cookbook on another of your devices — to share recipes with anyone else, add them as a friend instead.</div>' +
    AppLinkFieldHTML("Safe to share with anyone. It opens the app, nothing more.") +
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

function ActionsModalHTML() {
  return modalShell("Actions",
    '<div style="display:flex; flex-direction:column; gap:8px;">' +
      '<button class="btn btn-primary btn-block" onclick="Actions.closeModal(); Actions.openNew();">' + icon("plus", 16) + ' New recipe</button>' +
      '<button class="btn btn-block" onclick="Actions.closeModal(); Actions.openFriends();">' + icon("users", 16) + ' Friends' + (state.incoming.length ? " (" + state.incoming.length + " waiting)" : "") + '</button>' +
      '<button class="btn btn-block" onclick="Actions.closeModal(); Actions.openModal(\\'import\\');">' + icon("upload", 16) + ' Import recipes</button>' +
      '<button class="btn btn-block" onclick="Actions.closeModal(); Actions.exportAll();">' + icon("download", 16) + ' Export ' + (hasActiveFilter() ? "selected" : "all") + '</button>' +
      '<button class="btn btn-block" onclick="Actions.closeModal(); Actions.reload();">' + icon("sync", 16) + ' Reload from server</button>' +
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
  else if (state.modal === "owner") root.innerHTML = OwnerModalHTML();
  else if (state.modal === "filters") { root.innerHTML = FiltersModalHTML(); updateFilterScrollHint(); }
  else if (state.modal === "actions") root.innerHTML = ActionsModalHTML();
  else if (state.modal === "conflict") root.innerHTML = ConflictModalHTML();
  else if (state.modal === "locked") root.innerHTML = LockedModalHTML();
}

/* ====================================================================== */
/* Main render                                                             */
/* ====================================================================== */
function renderApp() {
  const app = document.getElementById("app");
  if (!state.session) { app.innerHTML = WelcomeViewHTML(); renderModal(); return; }
  if (state.loading) { app.innerHTML = '<div class="loading">Loading your recipe box…</div>'; renderModal(); return; }
  if (state.view === "library") app.innerHTML = LibraryViewHTML();
  else if (state.view === "detail") app.innerHTML = DetailViewHTML(getActiveRecipe());
  else if (state.view === "friends") app.innerHTML = FriendsViewHTML();
  else if (state.view === "edit") app.innerHTML = EditViewHTML();
  renderModal();
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
Actions.openDetail = function(id) {
  state.activeId = id; state.view = "detail"; state.scale = 1;
  state.customScaleOpen = false; state._showAllLogs = false;
  setWatch(id);
  renderApp();
};
Actions.backToLibrary = function() { state.view = "library"; setWatch(null); renderApp(); };
Actions.openFriends = function() { state.view = "friends"; setWatch(null); renderApp(); };
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

Actions.onSearchInput = function(v) { state.search = v; updateResultsSection(); };
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
Actions.setOwnerFilter = function(v) { state.ownerFilter = v; state.activeTags = []; updateLibraryChrome(); };
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
  if (name === "urlToRecipe") state.urlToRecipe = { mode: state._nextImportMode || "url", url: "", prompt: "", generated: false };
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
  if (u.mode === "url") {
    const el = document.getElementById("utr-url");
    const url = el ? el.value.trim() : "";
    if (!url) { toast("Paste a URL first"); return; }
    u.url = url;
  }
  u.prompt = buildImportPrompt(u.mode, u.url);
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
  state.session = loadSession();
  if (!state.session) { state.loading = false; renderApp(); return; }
  await refreshLibrary(true);
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
  "CREATE INDEX IF NOT EXISTS idx_shares_cookbook ON recipe_shares(cookbook_id)"
];
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  for (const sql of LATER_TABLES) await env.DB.prepare(sql).run();
  schemaReady = true;
}

const MARK_KINDS = ["pin", "star", "later"];

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
    const csql = "SELECT c.comment_id, c.recipe_id, c.username, c.rating, c.comment, c.cooked_on " +
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
        comment: c.comment, cookedOn: c.cooked_on
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

    const mates = (memberMap[me.cookbookId] || []).filter(n => n.toLowerCase() !== me.usernameLc);
    const friends = friendCbs
      .map(cb => ({ label: labelFor[cb], members: memberMap[cb] || [] }))
      .filter(f => f.label)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

    return jsonResponse({
      me: { username: me.username, cookbookId: me.cookbookId, household: labelFor[me.cookbookId] },
      recipes,
      comments,
      marks,
      shares,
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
      env.DB.prepare("DELETE FROM recipes WHERE recipe_id = ?").bind(recipeId)
    ]);
    return jsonResponse({ ok: true });
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
