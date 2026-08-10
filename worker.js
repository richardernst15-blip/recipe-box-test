// worker.js — Kindred Cupboard, all-in-one Cloudflare Worker
//
// One Worker serves the app itself and the D1-backed API behind it:
// accounts, recipes, cook-log comments and friendships.
//
// Routes:
//   POST /api/auth/signup        -> create an account, join a cookbook, or claim an old one
//   POST /api/auth/login         -> email and password in, session token out
//   POST /api/auth/logout        -> drop this device's session token
//   POST /api/account/password   -> change the password
//   POST /api/account/email      -> change the email address on the account
//   POST /api/admin/password     -> hand somebody a temporary password (admin token)
//   POST /api/library            -> everything visible to the signed-in user
//   POST /api/recipe/body        -> one recipe in full, with its cook log
//   POST /api/recipe/bodies      -> several recipes in full, for lists and exports
//   POST /api/recipe/rate        -> your cookbook's one rating, or clear it
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
//   POST /api/comment/add        -> log a cook (comment optional, no rating)
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
<meta name="apple-mobile-web-app-title" content="Kindred Cupboard" />
<meta name="theme-color" content="#ffffff" />
<link rel="apple-touch-icon" href="/icon-v2.png" />
<link rel="icon" href="/icon-v2.png" />
<link rel="preload" href="/fonts/alegreya-sans-500.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/fonts/fraunces-700.woff2" as="font" type="font/woff2" crossorigin />
<link rel="manifest" href="/manifest.webmanifest" />
<title>Kindred Cupboard</title>
<style>
/* The two brand faces, served from this worker rather than from a font CDN:
   the app is meant to be installable and self-contained, and a third party
   in the critical path is a third party who can make the app render wrong.
   Only the weights that are actually used are shipped. Google serves these
   at 500 and 700, not 400 and 700, so each file claims the range it is the
   best answer for - a rule asking for 400 or 600 then lands on a real file
   instead of a synthesised one. swap, so text is readable from first paint
   and reflows once rather than sitting invisible. */
@font-face{ font-family:"Fraunces"; font-style:normal; font-weight:400 500;
  font-display:swap; src:url("/fonts/fraunces-500.woff2") format("woff2"); }
@font-face{ font-family:"Fraunces"; font-style:normal; font-weight:600 700;
  font-display:swap; src:url("/fonts/fraunces-700.woff2") format("woff2"); }
@font-face{ font-family:"Alegreya Sans"; font-style:normal; font-weight:400 500;
  font-display:swap; src:url("/fonts/alegreya-sans-500.woff2") format("woff2"); }
@font-face{ font-family:"Alegreya Sans"; font-style:normal; font-weight:600 700;
  font-display:swap; src:url("/fonts/alegreya-sans-700.woff2") format("woff2"); }
:root{
  /* Kindred Cupboard brand kit. Three colours carry the whole app:
     terracotta #C1633C, tan #D6AF87, sage #8A9A7B. The page is white and
     every raised surface is a tint of the tan, so the card is the thing you
     see rather than the background it sits on. The tan at full strength is
     too saturated to read body text against, so it is kept for borders and
     accents and the surfaces are lightened out of it. */
  --bg:#ffffff; --card:#f5eadb; --card-alt:#efe1cd; --field:#fdf9f3;
  /* The palest of the warm neutrals, and the one that turned out to sit
     best under content: light enough that black text and terracotta
     headings both hold, warm enough not to read as a hole in the page.
     Same value as --field, kept separate because one names a surface and
     the other names what you type into. */
  --tile:#fdf9f3;
  --tan:#d6af87; --tan-deep:#c39a6c;
  /* Black, not a warm near-black. Every surface in the app is a tint now,
     and a softened ink on a tinted card is the thing that reads as faded.
     The secondary tone is darkened to match: it is still a step down from
     the body colour, but it is a dark step rather than a grey one. */
  --ink:#000000; --ink-muted:#3d3733; --border:#d6af87; --border-light:#ead9c2;
  --accent:#c1633c; --accent-dark:#a24e2c; --accent-soft:#f7e4d8; --accent-line:#e8c9b4;
  --sage:#8a9a7b; --sage-dark:#6e7e60; --sage-soft:#edf1e8; --sage-line:#cbd6c0;
  /* Stars are terracotta: a rating is the brand's own mark on a recipe, and
     a sage star sat apart from every other thing the app paints in the
     house colour. Empty stars are the same hue, drawn as an outline, so a
     three-out-of-five reads as one row rather than two colours. */
  --star:#c1633c;
  --gold:#c8850f; --green:#6e7e60;
  /* Destructive work keeps a red of its own. Terracotta is the brand now, so
     a Delete painted in it would read as any other button on the screen -
     the one thing a Delete must never do. */
  --danger:#8f2d24; --danger-dark:#742119; --danger-soft:#fbeceb; --danger-line:#e3b3ae;
  /* A meal you are cooking for other people is terracotta; a meal that is
     only yours is sage. That is the whole of what the colour has to say, and
     it says it on the calendar chip, the tile below it and the day sheet. */
  --meal:#c1633c; --meal-dark:#a24e2c; --meal-soft:#f7e4d8; --meal-line:#e8c9b4;
  /* What sits below the tab labels. The full safe-area inset is about 34px,
     which is generous: the home indicator is a few pixels tall sitting a
     little way up from the edge, so it wants clearing, not a whole band of
     its own. Twenty or so clears it and gives the rest back to the app.
     Declared once here because the toast and the page's own bottom padding
     both have to keep step with it. */
  --tab-pad-b: max(6px, calc(env(safe-area-inset-bottom) - 14px));
  /* Two faces. Fraunces is the display serif and takes the headings, the
     recipe names and anything that is a title; Alegreya Sans takes everything
     a person actually reads a sentence of, which includes the buttons and the
     fields, because a display serif at 13px on a phone is a decoration rather
     than a label. Fraunces replaced a Didone here for two reasons: hairlines
     go thin and cold on a warm tan card at phone sizes, and its flared, evenly
     weighted strokes are the same build as the wordmark in the logo, so a
     heading and the mark above it speak in one accent. Both fall back to a
     stack that is already installed, so the app is never waiting on a
     download to be legible. */
  --font-display: "Fraunces", Georgia, "Iowan Old Style", "Palatino Linotype", serif;
  --font-body: "Alegreya Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "SF Mono", Menlo, Consolas, monospace;
}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{
  background:var(--bg); color:var(--ink);
  font-family:var(--font-body);
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
/* The same hair of scroll again, on the root this time, because the body is
   not always the thing holding the document open. A modal pins the body -
   position:fixed - which takes it out of flow and collapses the document to
   nothing, and a document with nothing to scroll is precisely what hands the
   phantom toolbar space back. That is the shift every dialog came up with in
   portrait: the page jumped and a band of cream appeared below the tab bar,
   undimmed because it is chrome rather than page. Carrying the pixel on
   <html> means the document's scrollability does not change as a dialog
   opens and closes, so nothing ever cues iOS to re-reserve the bar. */
html.doc-scroll{ min-height:calc(100vh + 1px); min-height:calc(100dvh + 1px); }
html.doc-scroll #app{ height:auto; overflow:visible; overscroll-behavior:auto; }
/* And the pinned body gives up its own full-height minimum while it is
   pinned. position:fixed plus a viewport-sized height is the one shape iOS
   miscalculates the bottom of - the same shape the app shell was abandoned
   for - so a locked body must not be allowed to become it. Its height falls
   to whatever the page behind actually is; the canvas colour covers the rest,
   so there is nothing to see. */
html.doc-scroll body[data-scroll-lock]{ position:fixed; left:0; right:0; width:100%;
  min-height:0; }

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

/* Every heading takes the display face whether or not somebody remembered
   the class. The class stays because it is also used on a few things that
   are titles without being headings - a card name, a modal head. */
h1, h2, h3, .font-display, .modal-head h3, .col-title, .empty-state p.title{
  font-family:var(--font-display); }
.font-display{ font-weight:700; }
.font-mono{ font-family:var(--font-mono); }
.wrap{ max-width:960px; margin:0 auto; padding:0 16px calc(58px + var(--tab-pad-b,20px)); }
.hidden{ display:none !important; }

/* header */
/* Three things, stacked: what the app is, who you are, what you can do.
   The name gets its own line so the icon can be the real app icon at a size
   worth looking at, and the buttons drop to the row below where they have
   room for a word rather than just a glyph. */
.header{ padding:22px 0 16px; }
/* Centred on its own line. Only the mark moves - the name and the
   notification row underneath stay where they were, left-aligned. */
.header-brand{ position:relative; display:flex; flex-direction:column; align-items:center; gap:11px; }
/* Taken out of the flow on purpose: the logo is centred on the row, and a
   button sitting beside it in flow would centre the pair instead and shift
   the mark left by half a button. */
.header-menu-btn{ position:absolute; top:0; right:0; border:none; background:none;
  color:var(--ink); cursor:pointer; padding:6px; display:flex; align-items:center; }
.header-brand h1{ font-size:26px; margin:0; }
.app-icon{ width:34px; height:34px; border-radius:8px; flex-shrink:0; display:block; }
/* The logo says the name, so the heading beside it would be saying it twice.
   The h1 stays for a screen reader and for anything reading the page as an
   outline; it just is not drawn. */
.sr-only{ position:absolute; width:1px; height:1px; padding:0; margin:-1px;
  overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
/* One asset in three places, sized by its box rather than its own pixels so
   the tagline stays readable at the head of the library and never gets so
   large on the welcome page that it crowds the invitation under it. */
.brand-logo{ display:block; width:100%; height:auto; }
.header-brand .brand-logo{ max-width:250px; }
.welcome-wrap .brand-logo{ max-width:330px; margin:0 auto 6px; }
.header-row2{ display:flex; align-items:center; gap:10px; margin-top:9px; }
.header-who{ margin:0; font-size:13px; color:var(--ink-muted); min-width:0; }
.header-who b{ color:var(--ink); font-weight:600; }
.header-btns{ margin-left:auto; display:flex; gap:8px; align-items:center; flex-shrink:0; }
.bell{ position:relative; }
/* Sage inside a darker sage ring. The ring is what keeps it legible sitting
   on top of a terracotta button, where a flat sage disc would have gone
   soft at the edges. Black numerals: sage is a light fill and white on it
   at 10px is not a contrast anyone should have to squint through. */
.dot-badge{ position:absolute; top:-4px; right:-4px; min-width:16px; height:16px; padding:0 4px;
  border-radius:9px; background:var(--sage); border:1.5px solid var(--sage-dark); box-sizing:border-box;
  color:#fff; font-weight:700; font-size:10px; line-height:13px; text-align:center; }

/* search + filters */
.search-wrap{ position:relative; margin-bottom:10px; }
.search-wrap input{ width:100%; padding:12px 14px 12px 40px; border-radius:10px; border:1px solid var(--border); background:var(--field); font-size:15px; }
.search-wrap input:focus{ outline:2px solid var(--accent); outline-offset:-1px; }
.search-wrap .icon{ position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--sage); pointer-events:none; }
/* Two even halves, always. Letting the household button size itself to its
   label left the sort menu with a different width on every screen. */
.filter-row{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; }
.filter-row > *{ min-width:0; }
.filter-row select{ width:100%; padding:9px 10px; border-radius:9px; border:1px solid var(--border); background:var(--field); font-size:13.5px; color:var(--ink); }

/* Search, sort, household and Inspiration are four controls that do the same
   kind of job, so they are one grid of four identical cells rather than two
   rows that size themselves differently. The height is fixed here rather
   than left to each control's own padding, because a select and a button
   never agree on it. */
.lib-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; }
.lib-grid > *{ min-width:0; width:100%; height:44px; box-sizing:border-box; }
.lib-grid .search-field{ position:relative; display:flex; align-items:center; }
.lib-grid .search-field input{ width:100%; height:44px; box-sizing:border-box;
  padding:0 38px 0 38px; border-radius:10px; border:1px solid var(--border);
  background:var(--field); font-size:15px; }
.lib-grid .search-field input:focus{ outline:2px solid var(--accent); outline-offset:-1px; }
.lib-grid .icon{ position:absolute; left:11px; top:50%; transform:translateY(-50%);
  color:var(--sage); pointer-events:none; display:flex; }
.lib-grid select{ padding:0 8px; border-radius:10px; border:1px solid var(--border);
  background:var(--field); font-size:13.5px; color:var(--ink); }
.lib-grid .btn{ display:flex; align-items:center; justify-content:center; gap:5px;
  padding:0 10px; border-radius:10px; font-size:13.5px; overflow:hidden; }

/* chips */
.chips{ display:flex; flex-wrap:wrap; align-content:flex-start; gap:8px; margin-bottom:16px; max-height:112px; overflow-y:auto; padding-right:2px; }
.chip{ font-size:12.5px; line-height:18px; padding:6px 13px; border-radius:999px; border:1px solid var(--border); background:var(--card); color:var(--ink-muted); cursor:pointer;
  -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
.chip.active{ background:var(--accent); border-color:var(--accent); color:#fff; }
/* A tag being excluded. Grey rather than accent, because it is doing the
   opposite job to the lit ones beside it. */
.chip.not{ background:var(--ink-muted); border-color:var(--ink-muted); color:#fff; }

/* buttons */
/* A button is terracotta. There is no quieter second tier any more, so the
   two that mean something other than "do the thing" carry their own colour
   instead of their own shade: Accept is sage, Decline is the danger red. */
.btn{ display:inline-flex; align-items:center; gap:6px; font-size:14px; padding:9px 14px; border-radius:9px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; }
.btn:hover{ background:var(--accent-dark); border-color:var(--accent-dark); }
.btn:disabled{ opacity:.4; cursor:not-allowed; }
.btn-primary{ background:var(--accent); border-color:var(--accent); color:#fff; }
.btn-primary:hover{ background:var(--accent-dark); }
.btn-ghost{ border-color:transparent; background:transparent; color:var(--ink-muted); }
.btn-ghost:hover{ background:transparent; border-color:transparent; color:var(--accent); }
.btn-sm{ padding:6px 10px; font-size:13px; }
.btn-block{ width:100%; justify-content:center; }
.btn-ok{ background:var(--sage); border-color:var(--sage); color:#fff; }
.btn-ok:hover{ background:var(--sage-dark); border-color:var(--sage-dark); }
.btn-no{ background:var(--danger); border-color:var(--danger); color:#fff; }
.btn-no:hover{ background:var(--danger-dark); border-color:var(--danger-dark); }

/* A button is something you press, not something you read, and a second tap
   landing on one was selecting the word under it - which on the import menu
   left "From Pasted Text" looking half-picked before anything was picked. */
.btn, .mark, .tile, .chip, .scale-btn, .import-choice{
  -webkit-user-select:none; user-select:none; }
/* Where there is no pointer to hover with, the darkened state is not a
   preview of what you are about to press - it is what the last thing you
   pressed keeps wearing until you press something else. On the import menu
   that read as a choice already made. Nothing here changes on a desktop. */
@media (hover: none){
  .btn:hover{ background:var(--accent); border-color:var(--accent); }
  .btn-primary:hover{ background:var(--accent); }
  .btn-ghost:hover{ background:transparent; border-color:transparent; color:var(--ink-muted); }
  .btn-ok:hover{ background:var(--sage); border-color:var(--sage); }
  .btn-no:hover{ background:var(--danger); border-color:var(--danger); }
  .notif .btn:hover{ background:var(--sage-dark); border-color:var(--sage-dark); }
  .notif.read .btn:hover{ background:var(--sage-soft); border-color:var(--sage-line); color:var(--ink); }
}

/* recipe grid / cards */
.grid-recipes{ display:grid; grid-template-columns:repeat(auto-fill,minmax(225px,1fr)); gap:14px; }
.load-more{ display:flex; flex-direction:column; align-items:center; gap:6px; padding:22px 0 6px; }
.load-more-count{ margin:0; font-size:12.5px; color:var(--ink-muted); }
.rcard{ text-align:left; background:var(--tile); border:1px solid var(--tan); border-radius:13px; padding:16px; cursor:pointer; display:flex; flex-direction:column; gap:8px; transition:border-color .15s, box-shadow .15s; }
.rcard:hover{ border-color:var(--accent); box-shadow:0 3px 12px rgba(42,35,32,.10); }
.rcard h3{ font-size:18px; margin:0; line-height:1.28; color:var(--accent); }
.rcard .desc{ font-size:13px; color:var(--ink-muted); margin:0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
/* The same terracotta a chosen filter wears, so the tag on a card and the
   chip that would find it are visibly the same thing. Terracotta is dark
   enough to take white; every lighter fill in the app takes black. */
.tag{ font-size:11px; background:var(--accent); color:#fff; padding:3px 9px; border-radius:999px; display:inline-block; }
.tag-row{ display:flex; flex-wrap:wrap; gap:5px; align-items:center; }
/* Ringed in the full terracotta rather than left as a bare tint: on the
   new tile colour the soft fill alone was close enough to the card behind
   it that the name stopped reading as a badge at all. */
.owner-badge{ font-size:11px; color:var(--ink); background:var(--accent-soft); border:1px solid var(--accent); border-radius:999px; padding:3px 9px; display:inline-block; }
.card-foot{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:auto; padding-top:4px; }
.cooked-count{ font-size:12.5px; color:var(--ink-muted); }
/* Sits under the credit line on your own recipes only. Muted on purpose:
   it is news, not a score. */
.mark-interest{ display:flex; align-items:center; gap:6px; margin:-4px 0 10px;
  font-size:12.5px; color:var(--ink-muted); }
.mark-interest svg{ flex-shrink:0; color:var(--sage); }

.stars{ display:inline-flex; align-items:center; gap:4px; font-size:12.5px; color:var(--ink-muted); }
.stars svg{ width:14px; height:14px; }
.star-filled{ fill:var(--star); stroke:var(--star); }
.star-empty{ fill:none; stroke:var(--star); }
.no-rating{ color:var(--ink-muted); font-size:12.5px; }

.pill{ display:inline-flex; align-items:center; gap:5px; font-size:11.5px; padding:4px 10px; border-radius:999px; border:1px solid var(--border); background:var(--card); color:var(--ink-muted); cursor:pointer; }
.pill-shared{ color:var(--ink); border-color:var(--sage-line); background:var(--sage-soft); }

.empty-state{ text-align:center; padding:64px 20px; border:2px dashed var(--border); border-radius:16px; }
.empty-state p.title{ font-size:19px; margin:0 0 6px; }
.empty-state p.sub{ font-size:13.5px; color:var(--ink-muted); margin:0 0 16px; }
.empty-actions{ display:flex; justify-content:center; gap:8px; flex-wrap:wrap; }

/* detail */
.detail-top{ display:flex; align-items:center; justify-content:space-between; gap:8px; padding:20px 0 14px; }
/* Cook mode, Share and Edit share the right-hand corner. Share is icon-only
   because the glyph carries itself; Cook mode is labelled because a flame on
   its own would be a guess. */
/* Stretched rather than each sized on its own: Cook wears the mark's
   padding and Edit the button's, which came out two pixels apart and read
   as a misalignment. The tallest sets the row and the rest come up to it. */
.detail-top-actions{ display:flex; align-items:stretch; gap:6px; flex-shrink:0; }
/* Cook wears the same quiet outline as Schedule until it is switched on:
   three buttons in a row on a recipe, only one of which was painted as the
   thing to press, read as an instruction rather than a choice. Lit, it is
   the same terracotta as Favorite and Pin - one colour for "this is on",
   rather than a second shade that had to be learned separately. */
.cook-btn.on{ color:#fff; border-color:#fff; background:var(--accent); }
/* A private recipe has no link to hand out. The button stays where it is and
   greys rather than vanishing, so the corner does not reshuffle between one
   recipe and the next. */
.icon-btn[disabled]{ opacity:.35; cursor:default; pointer-events:none; }
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
.back-link{ display:inline-flex; align-items:center; gap:3px; color:var(--sage-dark); background:none; border:none; font-size:14px; cursor:pointer; padding:4px 0; }
.detail-title{ font-size:29px; margin:0 0 6px; line-height:1.15; color:var(--accent); }
.detail-desc{ margin:0 0 8px; color:var(--ink-muted); font-size:14px; line-height:1.45; }
.detail-desc{ color:var(--ink-muted); margin:0 0 10px; font-size:15px; }
.detail-meta{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:22px; }
.dot{ color:var(--border); }
.provenance{ font-size:12.5px; color:var(--ink-muted); background:var(--card-alt); border:1px solid var(--border-light); border-radius:9px; padding:8px 11px; margin-bottom:18px; }

.row2{ display:flex; flex-wrap:wrap; gap:14px; margin-bottom:22px; }
.panel{ flex:1; min-width:250px; background:var(--card); border:1px solid var(--tan); border-radius:13px; padding:15px 16px; }
.panel-label{ font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-muted); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; }

/* The chips fill the box rather than huddling at its left edge. Growing
   from their natural width means the short labels - 1x, 2x, 4x - take the
   larger share of what is going spare and end up closer in size to Custom
   beside them, instead of every chip being padded out equally and the row
   staying as lopsided as it started. */
.scale-row{ display:flex; flex-wrap:wrap; gap:5px; align-items:stretch; }
.scale-btn{ flex:1 1 auto; justify-content:center; padding:7px 9px; border-radius:8px; border:1px solid var(--border); background:var(--card); font-size:14px; cursor:pointer; white-space:nowrap; display:inline-flex; align-items:center; }
.scale-btn.active{ background:var(--accent); border-color:var(--accent); color:#fff; }
/* The chip asks rather than answers: typing a multiplier into a control this
   small never worked on a phone, so the chip opens a box and reads back
   whatever came out of it. Its own width is left to the label. */
.scale-custom{ display:inline-flex; align-items:center; padding-left:10px; padding-right:10px; }
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
.col-title{ font-size:16.5px; margin:0 0 12px; padding-bottom:8px; border-bottom:1px solid var(--tan); color:var(--accent); }
/* The list is folded away by default. The modal's job is the day and the
   number; the amounts are there to be checked, not to be scrolled past every
   time. The fold is remembered for the session, so somebody who does want to
   watch them change only opens it once. */
.ing-toggle{ display:flex; align-items:center; gap:7px; width:100%; padding:0; border:0;
  background:none; cursor:pointer; font:inherit; font-size:11px; text-transform:uppercase;
  letter-spacing:.05em; color:var(--ink-muted); }
.ing-toggle svg{ flex-shrink:0; color:var(--sage); }
.ing-toggle[aria-expanded="true"] + .ing-list{ margin-top:8px; }
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

.rate-section{ border-top:1px solid var(--border-light); padding-top:16px; margin-top:18px; }
.rate-row{ display:flex; align-items:center; gap:2px; flex-wrap:wrap; }
.rate-row .rate-star{ padding:3px; display:inline-flex; }
.rate-row .btn{ margin-left:10px; }
.body-loading{ padding:22px 0; }
.log-section{ border-top:1px solid var(--border-light); padding-top:18px; }
.log-header{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
.log-header h2{ font-size:16.5px; margin:0; }
.log-item{ display:flex; justify-content:space-between; gap:10px; padding:11px 0; border-bottom:1px solid var(--border-light); }
.log-item:last-child{ border-bottom:none; }
/* The log is read, not scanned: who cooked it, when, and what they said
   about it are the whole point of the section, and they were set smaller
   than the ingredients above them. The heading keeps its own size - it is a
   label for the block, not part of what you read. */
.log-user{ font-size:16px; font-weight:600; }
.log-date{ font-size:14px; color:var(--ink-muted); }
.log-notes{ font-size:15px; color:var(--ink-muted); margin:4px 0 0; line-height:1.45; }
.log-section .helper-text{ font-size:14.5px; }
.log-right{ display:flex; flex-direction:column; align-items:flex-end; gap:4px; }
.show-all-btn{ background:none; border:none; color:var(--accent); font-size:13.5px; padding:8px 0 0; cursor:pointer; }

.change-banner{ display:flex; align-items:center; gap:10px; background:#fdf4e4; border:1px solid #e6cf9a; color:var(--ink); border-radius:10px; padding:10px 12px; margin-bottom:16px; font-size:13.5px; line-height:1.4; }
.change-banner .banner-text{ flex:1; min-width:0; }
.change-banner button{ flex-shrink:0; }
.change-banner .btn{ background:var(--field); border-color:#e6cf9a; color:var(--ink); }

/* forms */
.field{ margin-bottom:15px; }
.field label{ display:block; font-size:13px; color:var(--ink-muted); margin-bottom:5px; }
/* Email and password are ordinary fields and must look like ordinary fields.
   Leaving them off this list handed them back to the browser's own defaults,
   which on Safari meant a narrower box in a smaller face sitting directly
   under a full-width Name. */
.field input[type=text], .field input[type=number], .field input[type=date], .field input[type=url],
.field input[type=email], .field input[type=password],
.field textarea, .field select{
  width:100%; padding:9px 10px; border-radius:8px; border:1px solid var(--border); font-size:14.5px; background:var(--field);
}
.field textarea{ resize:vertical; }
/* Safari sizes a date input to its own content unless it is told otherwise,
   which left Date cooked wider than the comment box below it. */
.field input[type=date]{ -webkit-appearance:none; appearance:none; display:block;
  min-width:0; max-width:100%; height:40px; }
.two-col{ display:flex; gap:12px; }
.two-col .field{ flex:1; }
.seg{ display:flex; gap:8px; }
.seg button{ flex:1; padding:11px 8px; border-radius:9px; border:1px solid var(--border); background:var(--card); font-size:13.5px; color:var(--ink-muted); cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; }
.seg button.active{ background:var(--accent); border-color:var(--accent); color:#fff; }
.req-note{ font-size:12.5px; color:var(--danger); margin:6px 0 0; }

.subhead-row{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.subhead-row .small-label{ font-size:13px; color:var(--ink-muted); }

.ing-row{ background:var(--card-alt); border-radius:10px; padding:9px; margin-bottom:7px; }
.ing-grid{ display:grid; grid-template-columns:1fr 0.9fr 1fr 0.9fr auto auto; gap:6px; margin-bottom:6px; align-items:center; }
.ing-grid input, .ing-grid select{ padding:7px 8px; border-radius:6px; border:1px solid var(--border); font-size:13px; width:100%; background:var(--field); }
.ing-name-input{ width:100%; padding:8px 9px; border-radius:6px; border:1px solid var(--border); font-size:14.5px; font-weight:600; margin-bottom:6px; }
.ing-notes-input{ width:100%; padding:7px 8px; border-radius:6px; border:1px solid var(--border); font-size:13px; }
.icon-btn{ border:none; background:none; cursor:pointer; color:var(--sage); padding:4px; display:flex; align-items:center; justify-content:center; }
.icon-btn:hover{ color:var(--sage-dark); }

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
.welcome-wrap .lede{ font-size:18px; color:var(--ink-muted); margin:0 0 22px; line-height:1.5; }
.brand-row{ display:flex; flex-direction:column; align-items:center; gap:10px; }
.brand-row h1{ margin:0; }
.welcome-icon{ width:44px; height:44px; }
/* Two screens in a row show this: the static one in the shell, before any
   script has run, and the one the app draws while it waits for the library.
   They are the same box with the same measurements on purpose. The logo is
   centred on the viewport and the line of text is held below it in flow, so
   the handover from one to the other moves nothing - the word changes and
   the mark stays exactly where it was. Give the two different paddings, or
   centre the pair rather than the logo, and the mark jumps. */
.boot-splash{ position:fixed; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; padding:32px; background:var(--bg); }
.boot-splash img{ width:100%; max-width:300px; height:auto;
  animation:boot-fade .5s ease both; }
/* Reserved whether or not there is anything in it, so the logo sits at one
   height across both screens. */
.boot-splash .boot-say{ height:22px; margin-top:18px; font-size:14.5px;
  color:var(--ink); display:flex; align-items:center; }
@keyframes boot-fade{ from{ opacity:0; } to{ opacity:1; } }
@media (prefers-reduced-motion: reduce){ .boot-splash img{ animation:none; } }
/* Two ways in, weighed the same, so neither reads as the expected one. They
   are a pair of switches rather than a stack of drawers: picking one drops
   the other, and whichever is on opens its panel underneath both. */
.gate{ display:flex; flex-direction:column; gap:10px; margin-top:4px; }
.gate-btns{ display:flex; gap:10px; }
.gate-btn{ flex:1; min-width:0; display:flex; align-items:center; justify-content:center;
  padding:14px 12px; border-radius:11px; border:1px solid var(--border); background:var(--card);
  font-size:18px; font-weight:600; color:inherit; cursor:pointer; font-family:inherit; }
.gate-btn.open{ border-color:var(--accent); background:var(--accent); color:#fff; }
/* Sized up as a group. This is the first thing a new person reads and it was
   set at the same scale as controls buried three taps into the app, which is
   the wrong place to be economical with type. Scoped to the panel, so nothing
   else moves. */
.gate-panel{ border:1px solid var(--border-light); border-radius:11px; padding:14px;
  background:var(--card-alt); margin-top:-4px; }
.gate-panel .field label{ font-size:15px; }
.gate-panel .field input, .gate-panel .field select{ font-size:16.5px; padding:11px 12px; }
.gate-panel .helper-text{ font-size:15px; }
.gate-panel .info-note{ font-size:14.5px; }
.gate-panel .check-row{ font-size:15.5px; }
.gate-panel .req-note{ font-size:14px; }
/* A tap target, not a footnote. */
.gate-panel .info-dot{ padding:3px; margin:-3px; }
.lbl-row{ display:flex; align-items:center; gap:6px; }
.info-dot{ background:none; border:0; padding:0; margin:0; line-height:0; color:var(--sage);
  display:inline-flex; cursor:pointer; }
.info-note{ font-size:12.5px; line-height:1.5; color:var(--ink-muted); background:var(--card);
  border:1px solid var(--border-light); border-radius:8px; padding:9px 10px; margin:6px 0 0; }
.check-row{ display:flex; align-items:flex-start; gap:9px; padding:8px 0; font-size:14px; line-height:1.45; }
.check-row input{ margin-top:2px; flex:none; }
.warn-box{ background:#fdf4e4; border:1px solid #e6cf9a; color:var(--ink); font-size:12.5px; line-height:1.55; padding:11px 12px; border-radius:9px; margin:0 0 16px; }
.warn-box b{ color:var(--ink); }
.code-box{ font-size:17px; letter-spacing:.1em; background:var(--card-alt); border:1px solid var(--border-light); border-radius:9px; padding:13px; text-align:center; margin-bottom:10px; word-break:break-all; }

/* friends */
.section-label{ font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-muted); margin:24px 0 4px; }
.friend-row{ display:flex; align-items:center; gap:9px; padding:12px 0; border-bottom:1px solid var(--border-light); }
.friend-name{ flex:1; font-size:15px; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.friend-sub{ font-size:12px; color:var(--ink-muted); }
.add-friend-row{ display:flex; gap:8px; }
.add-friend-row input{ flex:1; min-width:0; padding:10px 11px; border-radius:9px; border:1px solid var(--border); font-size:15px; background:var(--field); }

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
  background:none; display:flex;
  align-items:center; justify-content:center; z-index:80; overscroll-behavior:contain;
  padding:calc(20px + env(safe-area-inset-top)) 20px calc(20px + env(safe-area-inset-bottom)); }
/* The grey is a separate layer pinned to the whole window rather than the
   background of the box that centres the card. Sizing the two together meant
   that the moment the keyboard shrank the visual viewport, the overlay
   shrank with it and the page's cream showed through underneath - a bar
   along the foot of the installed app that appeared with the keyboard and
   went again with it. Painted first, so the card still sits on top. */
/* And it is deliberately bigger than the window it is pinned to. A fixed
   element is measured against the layout viewport, and on iOS that is not
   always the same as the glass you are looking at: focusing a field folds
   the toolbar away and hands the web view more room, and while the body is
   pinned there is no scroll to make iOS remeasure, so the layout viewport
   stays the old shorter one. The grey then stops an inch short of the foot
   of the screen and a strip of undimmed page shows below it - the cream
   band that arrives with the keyboard and leaves with it. Sliding the edges
   half a screen past the window in each direction means the grey covers
   whichever viewport turns out to be the live one. Nothing is lost off the
   sides: a fixed element adds no scrollable room, so the overshoot cannot
   be panned to. Vertical only, since that is the axis the two viewports
   disagree on, and it keeps the horizontal exactly as it was. */
.modal-overlay::before{ content:""; position:fixed; top:-50vh; left:0; right:0; bottom:-50vh;
  background:rgba(34,31,28,.5); }
.modal-box{ position:relative; background:var(--card); width:100%; max-width:560px; max-height:100%; overflow-y:auto;
  overscroll-behavior:contain; border-radius:16px; padding:22px; }
/* The two sheets that are a list of things to pick from rather than a form
   to fill in. They read as an extension of the shelf behind them, so they
   take the shelf's own surface. */
.modal-box.modal-tile{ background:var(--tile); }
.modal-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
.modal-head h3{ margin:0; font-size:19px; }
.modal-close{ border:none; background:none; color:var(--sage); cursor:pointer; padding:4px; }

/* The menu is the same overlay as every other sheet - same grey, same
   scroll lock, same tap-outside-to-close - hung off the right edge and run
   the full height instead of centred. A third of the screen is the shape
   asked for, but a third of a phone is 130px and a tile with a word under
   an icon does not fit in it, so the third has a floor and a ceiling. */
.drawer-overlay{ align-items:stretch; justify-content:flex-end; padding:0; }
.drawer-panel{ position:relative; background:var(--card); height:100%;
  width:min(320px, max(33vw, 240px)); overflow-y:auto; overscroll-behavior:contain;
  border-left:1px solid var(--border);
  padding:calc(16px + env(safe-area-inset-top)) 14px calc(16px + env(safe-area-inset-bottom));
  animation:drawer-in .18s ease both; }
@keyframes drawer-in{ from{ transform:translateX(100%); } to{ transform:translateX(0); } }
@media (prefers-reduced-motion: reduce){ .drawer-panel{ animation:none; } }
/* Two to a row, whatever the drawer's width turns out to be. The icon leads
   and the word sits under it, so a tile is a target rather than a line of
   text with a glyph in front of it. */
.tile-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.tile{ position:relative; display:flex; flex-direction:column; align-items:center;
  justify-content:flex-start; gap:7px; padding:13px 5px; border-radius:11px;
  border:1px solid var(--border-light); background:var(--card-alt); color:inherit;
  font:inherit; font-size:12.5px; line-height:1.25; text-align:center; cursor:pointer; }
.tile svg{ color:var(--accent); }
.tile:active{ border-color:var(--accent); background:var(--accent-soft); }

.helper-text{ font-size:13px; color:var(--ink-muted); margin-bottom:14px; line-height:1.5; }
.help-list{ margin:0 0 4px; padding-left:18px; font-size:13.5px; line-height:1.55; color:var(--ink-muted); }
.help-list li{ margin-bottom:7px; }
.help-list b{ color:var(--ink); font-weight:600; }
.step-block{ margin-bottom:16px; }
.step-block .step-label{ font-size:12.5px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:var(--ink-muted); margin-bottom:6px; }
.prompt-box{ width:100%; height:170px; font-family:var(--font-mono); font-size:11.5px; line-height:1.4; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--card-alt); resize:vertical; }
.response-box{ width:100%; height:110px; font-family:var(--font-mono); font-size:12px; padding:10px; border-radius:8px; border:1px solid var(--border); resize:vertical; }
.modal-error{ background:var(--danger-soft); border:1px solid var(--danger-line); color:var(--ink); font-size:13px; padding:9px 11px; border-radius:8px; margin-bottom:12px; }
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
  background:rgba(255,255,255,.94); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
  border-top:1px solid var(--tan);
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
/* Every tab is terracotta. The one you are on is the one at full strength
   in a heavier face; the rest are the same colour lightened, so the bar
   reads as one family with one of them lit rather than as four greys. */
.tabbar .tab{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:1px; padding:6px 0 4px; border:0; background:none; cursor:pointer;
  color:var(--accent); opacity:.45; font-size:10px; letter-spacing:.01em; }
.tabbar .tab span{ line-height:1.15; }
.tabbar .tab.on{ color:var(--accent); opacity:1; font-weight:700; }
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
.cal-cell{ height:92px; background:var(--tile); border:1px solid var(--border-light); border-radius:8px;
  padding:3px; overflow:hidden; cursor:pointer; display:flex; flex-direction:column; gap:2px; text-align:left; }
.cal-cell:active{ background:var(--card-alt); }
.cal-cell.cal-dim{ background:var(--card-alt); color:var(--ink-muted); }
.cal-cell.cal-today{ border-color:var(--accent); box-shadow:inset 0 0 0 1px var(--accent); }
.cal-num{ font-size:11.5px; font-weight:700; color:var(--ink-muted); display:flex; justify-content:space-between; gap:2px; }
.cal-today .cal-num{ color:var(--accent); }
.cal-mon{ font-size:9.5px; font-weight:700; text-transform:uppercase; color:var(--accent); }
.cal-chips{ display:flex; flex-direction:column; gap:2px; overflow:hidden; }
/* Each pill is ringed in the darker end of whatever colour it already
   wears: a scheduled recipe in sage, a meal dish in terracotta. On the
   paler day cell the soft fills alone had stopped holding their edges, and
   two stacked pills were reading as one block. */
.cal-chip{ display:block; width:100%; text-align:left; font-size:9.5px; line-height:1.25; padding:2px 3px;
  border:1px solid var(--sage-dark); border-radius:4px; background:var(--sage-soft); color:var(--ink); cursor:pointer;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cal-chip.cal-chip-orphan{ background:var(--border-light); border-color:var(--ink-muted); color:var(--ink-muted); }
.cal-chip.cal-chip-meal{ background:var(--meal-soft); border-color:var(--meal-dark); color:var(--meal-dark); }
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
.meal-tile{ border:1px solid var(--meal-line); border-radius:12px; background:var(--tile);
  margin-bottom:10px; overflow:hidden; }
.meal-tile.meal-mine{ border-color:var(--meal); }
.meal-tile.meal-focus{ box-shadow:0 0 0 2px var(--meal); }
/* The header is the meal itself - what it is, when, and whose - so it is
   given the whole terracotta rather than a tint of it, and everything in
   the bar is white. The tint it replaces sat only a shade off the tile
   below and the two ran together into one block of cream. */
.meal-head{ background:var(--meal); padding:10px 12px; border-bottom:1px solid var(--meal-line); color:#fff; }
.meal-head svg{ color:#fff; }
.meal-title{ font-size:15.5px; font-weight:700; color:#fff; margin:0 0 2px;
  display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
.meal-when{ font-size:12.5px; color:#fff; opacity:.92; }
.meal-host{ font-size:12px; color:#fff; opacity:.85; margin-top:2px; }
/* The dish search sits on the pale tile, so it steps down to the old card
   colour rather than up: a field you type into should not be the lightest
   thing in the box. */
.meal-tile .search-field input{ background:var(--card); }
.meal-body{ padding:10px 12px; }
.meal-sec{ font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-muted);
  margin:0 0 5px; }
.meal-sec + .meal-sec{ margin-top:12px; }
.meal-guests{ display:flex; flex-wrap:wrap; gap:5px; margin:0 0 12px; }
/* Every name in a meal is ringed the same way the author of a recipe is,
   so a person reads as a person wherever they turn up. */
.meal-guest{ display:inline-flex; align-items:center; gap:4px; font-size:12.5px;
  padding:3px 8px; border-radius:20px; border:1px solid var(--meal); background:var(--border-light); color:var(--ink); }
.meal-guest.on{ background:var(--meal-soft); color:var(--ink); }
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
/* Only on a real tile, where this box holds a person. The same box in the
   draft sheet holds "4 servings", which is not a name and gets no ring. */
.meal-tile .meal-dish-who{ border:1px solid var(--meal); border-radius:20px;
  padding:2px 8px; color:var(--ink); }
.meal-tile .meal-dish-who .icon-btn{ padding:0 0 0 2px; }
.meal-dish-who .icon-btn{ flex-shrink:0; }
.meal-dish .lots{ color:var(--gold); font-size:11.5px; flex-shrink:0; }
.meal-none{ font-size:13px; color:var(--ink-muted); margin:0 0 12px; }
.meal-actions{ display:flex; flex-wrap:wrap; gap:8px; }
/* Calling the whole thing off is not one of the three things you might do
   next - it is the one you do instead. Pushed to the far end so it is not
   sitting under your thumb next to Edit. */
.meal-cancel{ margin-left:auto; }
/* An invitation is a question and two answers, stacked: the asking on its own
   line, then Accept and Decline side by side underneath. Side by side with
   the question they were being squeezed to a third of the width each. */
.meal-invite{ display:flex; flex-direction:column; align-items:stretch; gap:9px;
  background:var(--meal-soft); border:1px solid var(--meal-line); border-radius:10px;
  padding:9px 12px; margin:0 0 12px; font-size:13px; color:var(--ink); }
.meal-invite .grow{ flex:1; min-width:0; }
.meal-invite-acts{ display:flex; align-items:center; gap:8px; }
.meal-invite-acts .btn{ flex:1; justify-content:center; }
/* The two lines a meal can carry beyond its name. Both are optional, so
   neither leaves a gap when it is not there. */
.meal-note{ font-size:12.5px; color:#fff; opacity:.88; margin:4px 0 0; }
.meal-where{ display:flex; align-items:flex-start; gap:5px; font-size:12.5px;
  color:#fff; opacity:.88; margin-top:3px; }
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
.meal-dish-pick{ display:grid; grid-template-columns:minmax(0,1fr) auto auto;
  grid-template-rows:auto auto; align-items:center; gap:6px 8px;
  background:var(--meal-soft); border:1px solid var(--meal-line); border-radius:10px;
  padding:9px 10px; margin-top:6px; font-size:13.5px; }
.meal-dish-pick .name{ grid-column:1; grid-row:1; min-width:0; font-weight:600; color:var(--ink);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.meal-dish-pick .qty{ grid-column:1; grid-row:2; display:flex; align-items:center; gap:6px; min-width:0; }
.meal-dish-pick input{ width:58px; flex-shrink:0; text-align:center; padding-left:4px; padding-right:4px; }
.meal-dish-pick .unit{ font-size:12px; color:var(--ink-muted); flex-shrink:1; min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.meal-dish-pick .btn{ grid-column:2; grid-row:1 / span 2; align-self:center;
  flex-shrink:0; padding-left:9px; padding-right:9px; }
.meal-dish-pick .icon-btn{ grid-column:3; grid-row:1 / span 2; align-self:center; }
.meal-dup{ background:#fdf6e6; border:1px solid #e8d5a0; border-radius:9px; padding:8px 10px;
  font-size:12.5px; color:var(--ink); margin-top:6px; }
.sched-banner{ display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  background:var(--sage-soft); border:1px solid var(--sage-line); border-radius:10px; padding:9px 12px;
  font-size:13px; color:var(--ink); margin-bottom:12px; }
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
.groc-entry{ display:flex; align-items:center; gap:10px; background:var(--card);
  border:1px solid var(--border-light); border-radius:11px; padding:12px 13px; }
.groc-entry-main{ flex:1; min-width:0; text-align:left; border:0; background:none; cursor:pointer; padding:0; }
.groc-entry-label{ font-size:14px; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.groc-entry-sub{ font-size:12px; color:var(--ink-muted); margin-top:2px; }
/* The plus at the end of a result used to be a bare span, so the one part of
   the row that looks like the button was the one part that did nothing. */
.groc-entry-plus{ flex-shrink:0; border:0; background:none; padding:6px; margin:-6px -4px -6px 0;
  cursor:pointer; color:var(--sage); display:flex; align-items:center; }
.groc-entry-plus:active{ color:var(--meal); }
/* One shopping line, collapsed: tick, name, quantity, grip - one line, no
   card. The old row stacked name over source over a quantity input and came
   to ~93px, which on a small phone is four items a screen. Name and quantity
   share a line, the source moves into the expanded editor, and the cards
   become one bordered list with hairline rules, which lands at ~44px. */
.groc-lines{ list-style:none; margin:0; padding:0; background:var(--card);
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
  min-height:44px; background:var(--card); touch-action:pan-y;
  transition:transform .18s ease; will-change:transform; }
.groc-row.swiping .groc-slide{ transition:none; }
.groc-row.swiped .groc-slide{ transform:translateX(-96px); }
.groc-swipe-back{ position:absolute; top:0; right:0; bottom:0; width:96px;
  display:flex; align-items:stretch; }
.groc-swipe-back button{ flex:1; border:0; cursor:pointer; color:#fff;
  font-size:12.5px; font-weight:600; display:flex; align-items:center;
  justify-content:center; gap:5px; background:var(--danger); padding:0; }
.groc-swipe-back button.put-back{ background:var(--sage); }
.groc-row.groc-done .groc-name{ text-decoration:line-through; color:var(--ink-muted); }
.groc-row.groc-dragging .groc-slide{ opacity:.65; background:var(--card-alt); }
.groc-row.merge-src .groc-slide{ background:var(--accent-soft); }
.groc-row.merge-target .groc-slide{ cursor:pointer; background:var(--field); }
.groc-row.merge-target .groc-name{ color:var(--accent-dark); }
.groc-tick{ flex-shrink:0; width:22px; height:22px; border-radius:6px;
  border:1.5px solid var(--border); background:var(--field); color:#fff; cursor:pointer;
  display:flex; align-items:center; justify-content:center; padding:0; }
.groc-tick.on{ background:var(--sage); border-color:var(--sage); }
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
.groc-grip{ flex-shrink:0; color:var(--sage); cursor:grab; padding:8px 3px;
  touch-action:none; -webkit-user-select:none; user-select:none; }

/* The editor. One row open at a time, so the list never grows by more than
   this much and the thing you tapped stays where you left it. */
.groc-edit{ padding:2px 9px 11px; background:var(--card-alt);
  border-bottom:1px solid var(--border-light); }
.groc-edit:last-child{ border-bottom:0; }
.groc-edit input.groc-name-input{ width:100%; font-size:14.5px; padding:7px 9px;
  border:1px solid var(--border); border-radius:8px; background:var(--field); }
.groc-from{ font-size:11.5px; color:var(--ink-muted); margin:6px 0 0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.groc-qty{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:8px; }
.groc-qty input{ width:78px; padding:5px 7px; font-size:13px; border-radius:7px;
  border:1px solid var(--border); background:var(--field); text-align:right; }
.groc-unit{ font-size:12px; color:var(--ink-muted); }
.groc-plus{ font-size:12px; color:var(--ink-muted); padding:0 1px; }
.groc-edit-acts{ display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
.groc-merge-hint{ background:var(--accent-soft); border:1px solid var(--accent-line); border-radius:10px;
  padding:9px 12px; font-size:13px; color:var(--ink); margin-bottom:10px;
  display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

/* A line you have said you do not need. Still there, still recoverable,
   plainly not part of the shop any more. */
.groc-row.groc-gone .groc-slide{ background:var(--card-alt); }
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
.merge-into svg{ color:var(--sage); flex-shrink:0; }
.groc-add{ width:100%; margin-top:10px; display:flex; align-items:center; justify-content:center; gap:6px; }
/* The name of an open list is the name of the list, and tapping a title to
   change it is the thing everyone tries first. */
.title-edit{ display:flex; align-items:flex-start; gap:8px; width:100%; margin:0 0 4px;
  padding:0; border:0; background:none; color:inherit; text-align:left; cursor:pointer; }
.title-edit svg{ color:var(--sage); flex-shrink:0; margin-top:7px; }
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
  background:rgba(255,255,255,.94); -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
  border-bottom:1px solid var(--border-light); }
.groc-bar-back{ flex-shrink:0; display:flex; align-items:center; border:0; background:none;
  color:var(--sage); cursor:pointer; padding:4px 2px; }
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
.sched-cell{ height:68px; background:var(--card); border:1px solid var(--border-light); border-radius:7px;
  padding:3px 2px; display:flex; flex-direction:column; align-items:center; gap:1px;
  cursor:pointer; overflow:hidden; font:inherit; }
.sched-cell.sched-today{ border-color:var(--accent); }
.sched-cell.on{ background:var(--sage-soft); border-color:var(--sage); box-shadow:inset 0 0 0 1px var(--sage); }
.sched-dow{ font-size:9px; text-transform:uppercase; letter-spacing:.04em; color:var(--ink-muted); }
.sched-num{ font-size:12.5px; font-weight:700; line-height:1; }
.sched-cell.on .sched-num{ color:var(--ink); }
.sched-chips{ display:flex; flex-direction:column; gap:1px; width:100%; overflow:hidden; }
.sched-chip{ display:block; font-size:8.5px; line-height:1.3; padding:0 2px; border-radius:3px;
  background:var(--sage-soft); color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* toast / loading */
body.tabs-down .toast{ bottom:calc(16px + var(--tab-pad-b,20px)); }
.toast{ position:fixed; bottom:calc(56px + var(--tab-pad-b,20px)); transition:bottom .2s ease; left:50%; transform:translateX(-50%); background:var(--ink); color:#fff; padding:9px 16px; border-radius:9px; font-size:13.5px; z-index:100; max-width:90vw; text-align:center; }
/* Superseded by .boot-splash, which this now reuses so the logo does not
   move when the shell hands over to the app. */
.loading{ display:flex; align-items:center; justify-content:center; height:75vh; color:var(--ink); font-size:14.5px; }

::-webkit-scrollbar{ width:8px; height:8px; }
::-webkit-scrollbar-thumb{ background:var(--border); border-radius:8px; }

.search-wrap { display:flex; gap:8px; align-items:center; }
.search-wrap input { flex:1; }
/* The field is its own positioning context so the clear button can sit
   inside the input's right edge rather than the row's. */
.search-field{ position:relative; flex:1; min-width:0; display:flex; align-items:center; }
.search-field input{ padding-right:40px; }
.search-clear{ position:absolute; right:7px; top:50%; transform:translateY(-50%);
  display:none; align-items:center; justify-content:center; width:26px; height:26px; padding:0;
  border:0; border-radius:50%; background:var(--border-light); color:var(--ink-muted); cursor:pointer; }
.search-clear.on{ display:flex; }
.search-clear:active{ background:var(--border); }
.search-filter { flex-shrink:0; display:flex; align-items:center; gap:5px; }
.search-filter .flabel { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.search-filter.on { background:var(--accent); color:#fff; border-color:var(--accent); }
.fcount { display:inline-block; flex-shrink:0; min-width:17px; padding:0 5px; border-radius:9px; background:var(--accent);
  color:#fff; font-size:11px; line-height:17px; text-align:center; margin-left:6px; }
/* Still occupies its slot, so a row is the same height counted or not. */
.fcount.zero { visibility:hidden; }
.search-filter.on .fcount { background:#fff; color:var(--accent); }
.chip-clear { border-style:dashed; }

/* One tap target per source, stacked, so the list reads as a menu rather
   than as a row of buttons that happens to wrap. */
.import-menu { display:flex; flex-direction:column; gap:8px; }
.import-choice { display:flex; align-items:center; gap:10px; text-align:left; padding:13px 14px; font-size:14.5px; }
.import-back { margin-bottom:10px; }

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
.owner-badge-btn{ cursor:pointer; border:1px solid var(--accent); }
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
/* Unread is loud and read is quiet, and the two use the same two colours to
   say it. Unread: the whole terracotta field with white on it, ringed and
   dotted in dark sage, and the way in filled dark sage too. Read: the same
   arrangement in every colour's pale variant, with the text back to black.
   Nothing moves between the two states and nothing is added or taken away,
   so a tile changing is read as the same tile going quiet rather than as
   something new arriving. */
.notif{ display:flex; gap:11px; align-items:flex-start; background:var(--accent); color:#fff;
  border:1px solid var(--sage-dark); border-left:3px solid var(--sage-dark);
  border-radius:10px; padding:12px 13px; margin-bottom:9px; cursor:pointer;
  -webkit-tap-highlight-color:transparent; }
/* Pressing does not swap the fill - on a solid tile that read as a state
   change rather than as a tap. */
.notif:active{ opacity:.9; }
.notif .btn{ background:var(--sage-dark); border-color:var(--sage-dark); color:#fff; }
.notif .btn:hover{ background:var(--sage); border-color:var(--sage); }
.notif-dot{ width:9px; height:9px; border-radius:50%; background:var(--sage-dark); flex-shrink:0; margin-top:5px; }
.notif-body{ flex:1; min-width:0; }
.notif-line{ font-size:14px; margin:0 0 3px; color:#fff; }
.notif-when{ font-size:11.5px; color:#fff; opacity:.85; font-variant-numeric:tabular-nums; }
/* What they said about the cook. Held a step back from the line above it by
   opacity rather than by a colour of its own, so it stays legible on both
   fills instead of picking one and failing on the other. */
.notif-said{ color:#fff; opacity:.85; }
.notif-acts{ display:flex; flex-direction:column; gap:6px; flex-shrink:0; }

.notif.read{ background:var(--accent-soft); color:var(--ink);
  border-color:var(--sage-line); border-left-color:var(--sage-line); }
.notif.read .notif-dot{ background:var(--sage-line); }
.notif.read .notif-line{ color:var(--ink); }
.notif.read .notif-when{ color:var(--ink); opacity:.7; }
.notif.read .notif-said{ color:var(--ink); opacity:.75; }
.notif.read .btn{ background:var(--sage-soft); border-color:var(--sage-line); color:var(--ink); }
.notif.read .btn:hover{ background:var(--sage-line); border-color:var(--sage-line); color:var(--ink); }

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
  background:linear-gradient(to top, var(--card) 15%, rgba(245,234,219,0)); pointer-events:none;
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
  border:1px solid rgba(0,0,0,.18); background:var(--card); color:inherit;
  -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
.fbox.on { background:var(--accent); border-color:var(--accent); color:#fff; }
.fbox.not { background:var(--ink-muted); border-color:var(--ink-muted); color:#fff; }
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
.mark{ border:1px solid var(--tan); background:var(--card); color:var(--ink-muted); border-radius:8px;
  padding:5px 7px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; line-height:0; }
.mark span{ font-size:12.5px; line-height:1.15; }
/* A mark that is on is a solid terracotta tile with a white ring and white
   contents. The tinted fill it replaces sat too close to the unlit button
   next to it to be read at a glance on a card. The three marks answer the
   same question, so they answer it in the same colour rather than sorting
   themselves into two, and they look the same on a card as on the recipe. */
.mark-star.on, .mark-later.on, .mark-pin.on{
  color:#fff; border-color:#fff; background:var(--accent); }
/* No on/off to it - the calendar button opens a frame rather than setting a
   flag - so it only ever shows the pressed state its neighbours share. */
.mark-cal:active{ color:var(--accent); border-color:var(--accent); background:var(--accent-soft); }
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
.pick-row.on{ border-color:var(--accent); background:var(--accent-soft); font-weight:600; }
/* The two share pickers paint a ticked friend in the house colour at full
   strength rather than the wash the guest list uses. On those sheets the tick
   is a grant of access to something of yours, and it reads better as a solid
   statement than as a tint. The sub-line has to be lifted off the terracotta
   with it, or it goes to mud. */
.pick-row-solid.on{ background:var(--accent); border-color:var(--accent); color:#ffffff; }
.pick-row-solid.on .friend-sub{ color:rgba(255,255,255,.85); }
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
<div id="app"><div class="boot-splash"><img src="/logo-v2.png" alt="Kindred Cupboard" /><div class="boot-say"></div></div></div>
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
  /* An "i" is what a field is for; a "?" is what to do when it goes wrong.
     They sit side by side on the sign-in password, so the two are drawn to
     the same weight and radius. */
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.2a2.7 2.7 0 1 1 3.4 2.7v1.6"/><circle cx="12.8" cy="16.6" r="1.1" fill="currentColor" stroke="none"/>',
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
  /* The one everybody knows from a phone: a tray open at the top with an
     arrow leaving it. Kept apart from the share glyph above, which Share App
     button still uses. */
  shareIos: '<path d="M8.5 10.5H6A1.8 1.8 0 0 0 4.2 12.3v7A1.8 1.8 0 0 0 6 21.1h12a1.8 1.8 0 0 0 1.8-1.8v-7a1.8 1.8 0 0 0-1.8-1.8h-2.5"/><line x1="12" y1="2.9" x2="12" y2="14.6"/><polyline points="8.4 6.4 12 2.9 15.6 6.4"/>',
  /* Cook mode. A flame reads as "this is the cooking one" at 16px where a
     screen or a lightbulb reads as settings. */
  flame: '<path d="M12 2.8c.5 2.9 2 4.1 3.2 5.6a6.6 6.6 0 0 1 1.6 4.3 4.8 4.8 0 0 1-9.6 0c0-1.5.6-2.8 1.5-3.7.3 1 .8 1.7 1.5 2.1.3-3-.3-5.5 1.8-8.3z"/>',
  inbox: '<path d="M3 12h4l2 3h6l2-3h4"/><path d="M5 5h14l2 7v7H3v-7z"/>',
  /* The three tabs along the foot. A scroll for the recipes, a month grid for
     the calendar, three boxes with the first ticked for the shopping. Drawn
     to read at 22px, which is all they are ever shown at. */
  scroll: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v13A2.5 2.5 0 0 1 16.5 21h-9A2.5 2.5 0 0 1 5 18.5z"/><path d="M5 7h14"/><path d="M5 17h14"/><line x1="9" y1="10.5" x2="15" y2="10.5"/><line x1="9" y1="13.5" x2="15" y2="13.5"/>',
  calGrid: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="6"/><line x1="16" y1="3" x2="16" y2="6"/><line x1="9" y1="10" x2="9" y2="21"/><line x1="15" y1="10" x2="15" y2="21"/><line x1="3" y1="15.5" x2="21" y2="15.5"/>',
  checklist: '<rect x="3" y="3.5" width="5.5" height="5.5" rx="1.4"/><polyline points="4.4 6.3 5.5 7.4 7.4 4.9"/><rect x="3" y="9.25" width="5.5" height="5.5" rx="1.4"/><rect x="3" y="15" width="5.5" height="5.5" rx="1.4"/><line x1="11" y1="6.25" x2="21" y2="6.25"/><line x1="11" y1="12" x2="21" y2="12"/><line x1="11" y1="17.75" x2="21" y2="17.75"/>',
  /* The three dots you drag a shopping line by. */
  undo: '<path d="M3 8h11a5.5 5.5 0 0 1 0 11h-6"/><polyline points="7 4 3 8 7 12"/>',
  grip: '<circle cx="12" cy="6" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="18" r="1.35" fill="currentColor" stroke="none"/>',
  /* The cog everyone already reads as Settings. A padlock was doing that job
     and saying the wrong thing: the sheet behind it is a name, an email and
     notification switches, not a security screen. Eight teeth around a hub,
     which is the shape that still reads as a cog at 16px. */
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0V21a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"/>',
  /* Three bars. The one glyph that has never meant anything but "more". */
  menu: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>'
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
/* A multiplier the way it would be written by hand: 6 rather than 6.00, and
   1.5 rather than 1.5000000000000002. Two decimals is as fine as the chip
   ever needs to be. */
function trimNumber(n) {
  const v = Number(n);
  if (isNaN(v)) return "";
  return String(Math.round(v * 100) / 100);
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
  /* Not an AI prompt at all - it reads recipes this app exported. It sits in
     the same menu because "where is this recipe coming from" is the same
     question either way. */
  json: {
    label: "From JSON", icon: "upload",
    intro: "", tail: ""
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

/* Cookbook IDs are issued by the server now, so there is nothing here to
   invent one with. */

/* ====================================================================== */
/* State                                                                   */
/* ====================================================================== */
const state = {
  session: null,
  loading: true,
  view: "library",
  activeId: null,
  /* Cards, not recipes: a name, a line, its tags and two numbers. Everything
     else lives in bodies and arrives when a recipe is opened. */
  recipes: [],
  /* recipeId -> the full body, once fetched. Kept for the session so going
     back into a recipe is instant and re-scaling never asks again. */
  bodies: {},
  /* recipeId -> its cook log, fetched alongside the body. */
  logs: {},
  /* Fingerprint of who we are linked to, straight from the last sync. When
     it moves, every cached log is suspect - see applyLibrary. */
  reach: null,
  /* recipeId -> { avg, count, mine } across every cookbook we can see. */
  ratings: {},
  /* recipeId -> { count, ours, last }. ours is what unlocks rating it. */
  cooks: {},
  /* Recent cooks by other people on our own recipes; the notifications page
     is the only thing that reads it. */
  cookFeed: [],
  /* Which recipe bodies are in flight, so a second tap does not ask twice. */
  bodyPending: {},
  /* Notifications on this device. status is one of: unknown, unsupported,
     install (iOS wants the app on the Home Screen first), off, on, denied,
     unavailable (no keys configured on the server). */
  push: { status: "unknown", key: "", busy: false, kinds: [], endpoint: "" },
  mates: [],
  friends: [],
  incoming: [],
  outgoing: [],
  declined: [],
  search: "",
  activeTags: [],
  /* The other half of the tag filter: labels a recipe must NOT carry. Long
     press a tag rather than tapping it. Kept apart from activeTags so the
     two can never contradict each other - a tag is chosen, banned, or
     neither, and switching between the three is one list move. */
  notTags: [],
  _fopen: {},
  /* The box opens on your own shelf. Everyone else's is a deliberate look
     rather than the thing you land on. Note this counts as a filter, so the
     export button offers what is actually on screen. */
  ownerFilter: "ours",
  friendsTab: "friends",
  myHousehold: "",
  marks: { pin: [], star: [], later: [] },
  /* recipeId -> how many other cookbooks pinned, favorited or saved it. Only
     ever populated for recipes of our own, and never says which cookbooks. */
  markCounts: {},
  shares: {},
  /* Which friends are ticked in the visibility sheet, while it is open. */
  visDraft: [],
  /* What is typed into the friend search on either of the two Selective
     share pickers. One field for both, because only one of them is ever on
     screen, and it is cleared whenever either is opened fresh. */
  shareFriendSearch: "",
  /* A recipe arrived at by share link. Held apart from state.recipes because
     it is not in this cookbook and may never be - the library is what you
     own or were given, and this is neither until it is pinned. */
  linkRecipe: null,
  linkError: "",
  /* Autofills the friends page when an author's name is tapped. */
  friendPrefill: "",
  pickSearch: "",
  sort: "newest",
  /* How many cards the box is currently drawing. The whole library is always
     in memory - search, tags, the shopping list and the calendar picker all
     read every recipe - but only this many are turned into markup at a time.
     Typing a letter rebuilds the results block from scratch, so at six
     hundred recipes that was six hundred card templates per keystroke on an
     iPad. _shownKey is the filter the count belongs to: change the search,
     the tags, the household or the sort and it no longer matches, which is
     what puts a fresh search back at the top of its own results. */
  shown: 0,
  _shownKey: null,
  scale: 1,
  customScaleOpen: false,
  /* The last multiplier accepted in the box, kept so the chip reads it back
     and so reopening the box starts from what you had rather than from blank.
     _scaleDraft is only what is sitting in the box while it is open. */
  customScale: "",
  _scaleDraft: "",
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
  /* The welcome screen, held in state rather than in the DOM: opening an
     info note or ticking the household box redraws the panel, and the fields
     have to survive that. _wPass never leaves memory. */
  _wMode: "",
  _wName: "",
  _wEmail: "",
  _wEmail2: "",
  _wPass: "",
  _wLoginEmail: "",
  _wLoginPass: "",
  _wCookbook: "",
  _wJoin: false,
  _wSave: true,
  _wInfo: {},
  _wBusy: false,
  intent: null,
  importParsed: [],
  importErrors: [],
  importVisibility: "",
  importFileName: null,
  urlToRecipe: { mode: "", url: "", text: "", prompt: "", generated: false },
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
  cookMode: false,
  shareId: null,
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
  schedIngOpen: false,
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
  /* The recipe on its way to a community meal, while that sheet is open. */
  mealAdd: null,
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

function summaryById(id) { return state.recipes.find(r => r.recipeId === id) || null; }
function getActiveRecipe() { return withBody(summaryById(state.activeId)); }
function recipeById(id) { return withBody(summaryById(id)); }
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

/* Every recipe booked in a date range. The shopping list is built out of
   their ingredients, and ingredients live in bodies, so this is what the
   builder fetches before it starts adding anything up. */
function scheduledRecipeIds(start, end) {
  const ids = [];
  state.schedule.forEach(function (e) {
    if (!e.date || e.date < start || e.date > end) return;
    if (e.recipeId && ids.indexOf(e.recipeId) < 0) ids.push(e.recipeId);
  });
  return ids;
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
/* The cook log for one recipe, which only exists once that recipe has been
   opened. Everywhere else works from the totals below. */
function commentsFor(id) { return state.logs[id] || []; }
/* What a card and a recipe header both need. avg and count are the rating -
   an average across cookbooks and how many of them voted - and cooks is a
   separate number entirely: how many times the thing has been made. mine is
   this cookbook's own rating, 0 for none, and ourCooks is what decides
   whether it is allowed to have one yet. */
function statsFor(id) {
  const r = state.ratings[id] || {};
  const c = state.cooks[id] || {};
  return {
    avg: (r.count ? r.avg : null),
    count: r.count || 0,
    mine: r.mine || 0,
    cooks: c.count || 0,
    ourCooks: c.ours || 0,
    lastCooked: c.last || null
  };
}
/* A body is either cached or it is not; there is no half-loaded recipe. The
   test is the presence of an ingredients array rather than a lookup in the
   cache, because a recipe opened from a share link never goes through the
   cache at all and still has to render. */
function hasBody(r) { return !!r && Array.isArray(r.ingredients); }
/* A card, with its body laid underneath if we have one. The summary wins on
   every field they share, so a title edited elsewhere is not masked by a
   stale cached body. */
function withBody(sum) {
  if (!sum) return null;
  const b = state.bodies[sum.recipeId];
  return b ? Object.assign({}, b, sum) : sum;
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
    const r = q.get("r"), f = q.get("f"), n = q.get("n");
    if (r) intent = { type: "recipe", recipeId: String(r).slice(0, 64) };
    else if (f) intent = { type: "friend", name: String(f).slice(0, 40) };
    /* Where a tapped notification wants to go. Not a scanned code, so it is
       never stashed for later - by the time there is a session to replay it
       against, it is not news any more. */
    else if (n) intent = { type: "push", target: String(n).slice(0, 80) };
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

const SESSION_KEY = "kindredCupboardSession";
/* Where the token lives is the whole of what the tick box decides. Ticked,
   it goes in localStorage and survives the app being closed; unticked, it
   goes in sessionStorage and does not. Reading looks in both, because the
   preference can change between one sign-in and the next. */
function loadSession() {
  const raw = (function () {
    try { const a = localStorage.getItem(SESSION_KEY); if (a) return a; } catch (e) {}
    try { const b = sessionStorage.getItem(SESSION_KEY); if (b) return b; } catch (e) {}
    return null;
  })();
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    /* Anything from before sign-in became an account is not a session any
       more, whatever it says. */
    return s && s.token ? s : null;
  } catch (e) { return null; }
}
function saveSession(s) {
  const raw = JSON.stringify(s);
  try {
    if (s && s.persist) { localStorage.setItem(SESSION_KEY, raw); sessionStorage.removeItem(SESSION_KEY); }
    else { sessionStorage.setItem(SESSION_KEY, raw); localStorage.removeItem(SESSION_KEY); }
  } catch (e) {}
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
}

/* The expensive half of the password hash, and the only place the plaintext
   is ever handled. The salt is the address rather than a random string kept
   on the server, so signing in never has to ask who you are before it can
   ask for the password - which would be a way of finding out which addresses
   have accounts on them. 100,000 rounds is the ceiling Cloudflare allows and
   costs a few hundred milliseconds here, where there is no CPU budget to
   blow. What leaves the device is the result; the password does not. */
async function derivePasswordKey(email, password) {
  const enc = new TextEncoder();
  const saltBuf = await crypto.subtle.digest(
    "SHA-256", enc.encode("kindredcupboard:" + String(email || "").trim().toLowerCase()));
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(String(password == null ? "" : password)), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new Uint8Array(saltBuf), iterations: 100000, hash: "SHA-256" }, key, 256);
  const bytes = new Uint8Array(bits);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}
const SUPPORT_EMAIL = "kindredcupboard@gmail.com";

async function API(path, payload) {
  const creds = (state.session && state.session.token) ? { token: state.session.token } : {};
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
  state.recipes = (data.recipes || []).map(row => ({
    recipeId: row.recipeId,
    owner: row.owner,
    household: row.household || row.owner,
    ours: !!row.ours,
    visibility: row.visibility,
    title: row.title || "Untitled recipe",
    description: row.description || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    /* One flat lowercase string of every ingredient name, which is all the
       search box ever did with them. */
    ingNames: row.ingNames || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy || row.owner
  }));
  state.ratings = data.ratings || {};
  state.cooks = data.cooks || {};
  state.cookFeed = data.cookFeed || [];
  /* A body cached before somebody else saved over it is no longer that
     recipe. Dropping it here is what makes the cache safe to keep for the
     whole session: every sync re-checks it against the version on the shelf. */
  /* A reach change is the one thing that check cannot catch. Befriending a
     household does not touch updated_at on any of its recipes, but it does
     change what their cook logs are allowed to contain - so on a stamp move
     the whole cache goes, rather than only the recipes that were edited. */
  const nextReach = data.reach || null;
  if (state.reach !== null && nextReach !== state.reach) {
    state.bodies = {};
    state.logs = {};
  }
  state.reach = nextReach;
  const live = {};
  state.recipes.forEach(function (r) { live[r.recipeId] = r.updatedAt; });
  Object.keys(state.bodies).forEach(function (id) {
    if (!(id in live) || live[id] !== state.bodies[id]._at) {
      delete state.bodies[id];
      delete state.logs[id];
    }
  });
  state.myHousehold = (data.me && data.me.household) || state.session.username;
  state.marks = data.marks || { pin: [], star: [], later: [] };
  state.markCounts = data.markCounts || {};
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

/* ---- fetching the parts a card left behind -----------------------------
   One recipe at a time when somebody opens one, in batches when a shopping
   list or an export needs a lot at once. Both write into the same cache, and
   both are safe to call on something already cached: that is the ordinary
   case, and it costs nothing. */
function cacheBody(recipeId, data, updatedAt) {
  const b = normalizeBody(data);
  b._at = updatedAt || null;
  state.bodies[recipeId] = b;
  return b;
}
async function ensureBody(recipeId) {
  if (!recipeId || !state.session) return null;
  if (state.bodies[recipeId]) return state.bodies[recipeId];
  /* Already asked for. Waiting on the same promise rather than firing a
     second request is what stops a double tap costing two round trips. */
  if (state.bodyPending[recipeId]) return state.bodyPending[recipeId];
  const p = (async function () {
    try {
      const res = await API("recipe/body", { recipeId: recipeId });
      state.logs[recipeId] = res.log || [];
      return cacheBody(recipeId, res.data, res.updatedAt);
    } catch (e) {
      if (e.code !== "AUTH") toast("Couldn't open that recipe — " + e.message);
      return null;
    } finally {
      delete state.bodyPending[recipeId];
    }
  })();
  state.bodyPending[recipeId] = p;
  return p;
}
/* The server answers at most BODY_BATCH at a time, so a long list is walked
   in slices rather than asked for in one impossible request. */
const BODY_BATCH = 40;
async function ensureBodies(ids) {
  const want = [];
  (ids || []).forEach(function (id) {
    if (id && !state.bodies[id] && want.indexOf(id) < 0) want.push(id);
  });
  if (!want.length) return;
  for (let i = 0; i < want.length; i += BODY_BATCH) {
    const slice = want.slice(i, i + BODY_BATCH);
    let res;
    try { res = await API("recipe/bodies", { recipeIds: slice }); }
    catch (e) { if (e.code !== "AUTH") toast("Couldn't load those recipes — " + e.message); return; }
    (res.bodies || []).forEach(function (row) {
      cacheBody(row.recipeId, row.data, row.updatedAt);
    });
  }
}
/* Opening a recipe draws the name, the description and the tags immediately
   and fills the rest in underneath. The flag is what the body area reads to
   decide between a quiet line of text and the food. */
async function loadBodyInto(recipeId, after) {
  await ensureBody(recipeId);
  if (state.activeId !== recipeId) return;
  if (typeof after === "function") after();
  updateRecipeBody();
}

/* ====================================================================== */
/* Render: Welcome                                                         */
/* ====================================================================== */
const INFO_NAME = "Shown to your friends when you add a recipe, add a friend, or comment on a recipe.";
const INFO_EMAIL = "Never shared outside the app, or with anyone else using it. It is used only to sign you in, to recover your account, and for critical messages from Kindred Cupboard.";
const INFO_PASS = "At least 8 characters. It is scrambled on this device before it is sent, so nobody else ever sees it.";
const INFO_COOKBOOK = "Ten letters and numbers, from whoever you share a kitchen with. A cookbook holds two people; anyone else you cook with is a friend instead.";
const INFO_FORGOT = "Write to " + SUPPORT_EMAIL + " from the address on your account and we will send you a temporary password.";
function infoDot(key) {
  return '<button class="info-dot" title="What this is for" onclick="Actions.wInfo(\\'' + key + '\\')">' +
    icon("info", 18) + '</button>';
}
/* The same control with a different question behind it: not what the field
   is, but what to do when you cannot fill it in. */
function helpDot(key) {
  return '<button class="info-dot" title="Forgotten your password?" onclick="Actions.wInfo(\\'' + key + '\\')">' +
    icon("question", 18) + '</button>';
}
function infoNote(key, text) {
  return (state._wInfo && state._wInfo[key]) ? '<p class="info-note">' + esc(text) + '</p>' : "";
}
function gateButtonHTML(key, label) {
  const open = state._wMode === key;
  return '<button class="gate-btn' + (open ? " open" : "") + '" onclick="Actions.wMode(\\'' + key + '\\')">' +
    '<span>' + label + '</span></button>';
}
function saveBoxHTML(id) {
  return '<label class="check-row"><input type="checkbox" id="' + id + '"' +
    (state._wSave ? " checked" : "") + ' />' +
    '<span>Save my sign-in on this device, so I stay signed in.</span></label>';
}
function newUserPanelHTML() {
  return '<div class="gate-panel">' +
    '<div class="field"><label class="lbl-row">Name' + infoDot("name") + '</label>' +
      '<input type="text" id="w-name" autocapitalize="words" autocorrect="off" spellcheck="false" value="' + esc(state._wName || "") + '" />' +
      infoNote("name", INFO_NAME) +
    '</div>' +
    '<div class="field"><label class="lbl-row">Email' + infoDot("email") + '</label>' +
      '<input type="email" id="w-email" autocapitalize="none" autocorrect="off" spellcheck="false" value="' + esc(state._wEmail || "") + '" />' +
      infoNote("email", INFO_EMAIL) +
    '</div>' +
    '<div class="field"><label>Confirm email</label>' +
      '<input type="email" id="w-email2" autocapitalize="none" autocorrect="off" spellcheck="false" value="' + esc(state._wEmail2 || "") + '" />' +
    '</div>' +
    '<div class="field"><label class="lbl-row">Password' + infoDot("pass") + '</label>' +
      '<input type="password" id="w-pass" autocomplete="new-password" value="' + esc(state._wPass || "") + '" />' +
      infoNote("pass", INFO_PASS) +
    '</div>' +
    saveBoxHTML("w-save") +
    '<label class="check-row"><input type="checkbox" id="w-join"' + (state._wJoin ? " checked" : "") +
      ' onchange="Actions.wToggleJoin()" />' +
      '<span>Join a household cookbook I have been given the ID for.</span></label>' +
    (state._wJoin
      ? '<div class="field"><label class="lbl-row">Cookbook ID' + infoDot("cookbook") + '</label>' +
          '<input type="text" id="w-cookbook" class="font-mono" style="text-transform:uppercase" autocapitalize="characters" autocorrect="off" spellcheck="false" value="' + esc(state._wCookbook || "") + '" />' +
          infoNote("cookbook", INFO_COOKBOOK) +
        '</div>'
      : "") +
    '<button class="btn btn-primary btn-block" ' + (state._wBusy ? "disabled" : "") +
      ' onclick="Actions.signUp()">' + (state._wBusy ? "Working…" : "Create my account") + '</button>' +
  '</div>';
}
function existingUserPanelHTML() {
  return '<div class="gate-panel">' +
    '<div class="field"><label class="lbl-row">Email' + infoDot("lemail") + '</label>' +
      '<input type="email" id="w-lemail" autocapitalize="none" autocorrect="off" spellcheck="false" value="' + esc(state._wLoginEmail || "") + '" />' +
      infoNote("lemail", INFO_EMAIL) +
    '</div>' +
    '<div class="field"><label class="lbl-row">Password' + infoDot("lpass") + helpDot("forgot") + '</label>' +
      '<input type="password" id="w-lpass" autocomplete="current-password" value="' + esc(state._wLoginPass || "") + '" />' +
      infoNote("lpass", INFO_PASS) +
      infoNote("forgot", INFO_FORGOT) +
    '</div>' +
    saveBoxHTML("w-lsave") +
    '<button class="btn btn-primary btn-block" ' + (state._wBusy ? "disabled" : "") +
      ' onclick="Actions.signIn()">' + (state._wBusy ? "Working…" : "Sign in") + '</button>' +
  '</div>';
}
function WelcomeViewHTML() {
  return '' +
    '<div class="welcome-wrap">' +
      '<div class="brand-row"><img class="brand-logo" src="/logo-v2.png" alt="Kindred Cupboard" />' +
        '<h1 class="sr-only">Kindred Cupboard</h1></div>' +
      '<p class="lede">Break bread together. Store and share recipes together. Craft meals together. Kindred Cupboard makes it easy.</p>' +
      (state._arrivedByScan
        ? '<div class="import-summary">Someone shared something with you. Set up an account here and it will pick up where the code left off.</div>'
        : "") +
      (state.modalError ? '<div class="modal-error">' + esc(state.modalError) + '</div>' : "") +
      '<div class="gate">' +
        '<div class="gate-btns">' +
          gateButtonHTML("new", "New User") +
          gateButtonHTML("existing", "Existing User") +
        '</div>' +
        (state._wMode === "new" ? newUserPanelHTML()
          : state._wMode === "existing" ? existingUserPanelHTML() : "") +
      '</div>' +
    '</div>';
}

/* ====================================================================== */
/* Render: Library                                                         */
/* ====================================================================== */
function ratingHTML(avg, count) {
  if (avg == null) return '<span class="no-rating">Not yet rated</span>';
  const rounded = Math.round(avg);
  let stars = "";
  for (let n = 1; n <= 5; n++) stars += icon("star", 14, n <= rounded ? "star-filled" : "star-empty");
  return '<span class="stars"><span style="display:inline-flex">' + stars + '</span>' +
    '<span class="font-mono">' + avg.toFixed(1) + '</span><span>(' + count + ')</span></span>';
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
function appQrHTML(px) { return qrSvgHTML(appUrl(), px, "QR code linking to Kindred Cupboard"); }
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

  /* Cooks by somebody else on a recipe of ours. This used to be sifted out
     of every comment in the library; now the server sends the recent ones
     and nothing else, because that is all this page ever showed. */
  state.cookFeed.forEach(function (c) {
    const mine = ours[c.recipeId];
    if (!mine) return;
    if (String(c.username).toLowerCase() === meLc) return;   /* our own log */
    out.push({
      id: "cook:" + c.commentId, kind: "cook", at: c.createdAt || c.cookedOn,
      who: c.username, title: mine.title, recipeId: c.recipeId,
      comment: c.comment, cookedOn: c.cookedOn
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

/* ---- notifications that arrive with the app shut ----------------------- */
/* Apple only does this for an app that has been added to the Home Screen,
   and only when a person taps to ask for it, so there is nothing automatic
   here: a button in Settings, and everything else follows from it. */
function pushSupported() {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  return ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window);
}
function onIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  /* An iPad on recent iPadOS calls itself a Mac; the touch test is what
     tells the two apart. */
  return /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && typeof document !== "undefined" && ("ontouchend" in document));
}
function installedApp() {
  if (typeof navigator !== "undefined" && navigator.standalone === true) return true;
  try {
    return window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches;
  } catch (e) { return false; }
}
/* The six things a notification can be about, in the order the panel shows
   them. The keys are the server's; the words are ours. */
const PUSH_KIND_LABELS = [
  ["friendAsk", "Friend requests"],
  ["friendYes", "When someone accepts your friend request"],
  ["mealAsk", "Meal invitations"],
  ["mealYes", "When a guest accepts your invitation"],
  ["cook", "When someone cooks one of your recipes"],
  ["recipe", "When a friend shares a new recipe"]
];
function pushKeyBytes(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = (t.length % 4) ? "====".slice(t.length % 4) : "";
  const bin = atob(t + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pushRegistration() {
  if (!pushSupported()) return null;
  try { return await navigator.serviceWorker.register("/sw.js", { scope: "/" }); }
  catch (e) { return null; }
}
async function refreshPushState() {
  const p = state.push;
  if (!pushSupported()) { p.status = onIOS() ? "install" : "unsupported"; return; }
  if (onIOS() && !installedApp()) { p.status = "install"; return; }
  if (!p.key) {
    try { const d = await API("push/key", {}); p.key = (d && d.key) || ""; } catch (e) { p.key = ""; }
  }
  if (!p.key) { p.status = "unavailable"; return; }
  if (Notification.permission === "denied") { p.status = "denied"; return; }
  const reg = await pushRegistration();
  if (!reg) { p.status = "unsupported"; return; }
  let sub = null;
  try { sub = await reg.pushManager.getSubscription(); } catch (e) { sub = null; }
  p.endpoint = sub ? sub.endpoint : "";
  p.status = sub ? "on" : "off";
  if (sub) {
    try {
      const d = await API("push/status", { endpoint: sub.endpoint });
      /* The server not knowing this endpoint means the browser is holding a
         subscription we have no row for - a database that was reset, or a
         sign-in as somebody else. Sign it up again rather than sit there
         claiming to be on and never ringing. */
      if (d && d.subscribed) p.kinds = d.kinds || [];
      else { p.status = "off"; p.endpoint = ""; }
    } catch (e) {}
  }
}
async function enablePush() {
  const p = state.push;
  const reg = await pushRegistration();
  if (!reg) { p.status = "unsupported"; return; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { p.status = (perm === "denied") ? "denied" : "off"; return; }
  let sub = null;
  try { sub = await reg.pushManager.getSubscription(); } catch (e) {}
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: pushKeyBytes(p.key)
    });
  }
  const j = sub.toJSON ? sub.toJSON() : { keys: {} };
  const d = await API("push/subscribe", {
    endpoint: sub.endpoint,
    p256dh: (j.keys && j.keys.p256dh) || "",
    auth: (j.keys && j.keys.auth) || ""
  });
  p.endpoint = sub.endpoint;
  p.kinds = (d && d.kinds) || [];
  p.status = "on";
}
async function disablePush() {
  const reg = await pushRegistration();
  let sub = null;
  if (reg) { try { sub = await reg.pushManager.getSubscription(); } catch (e) {} }
  if (sub) {
    /* Told to the server first: the row has to go even if the browser is
       slow to let go of its end of it. */
    try { await API("push/unsubscribe", { endpoint: sub.endpoint }); } catch (e) {}
    try { await sub.unsubscribe(); } catch (e) {}
  }
  state.push.endpoint = "";
  state.push.status = "off";
}

/* One switch flipped. Written straight through rather than gathered up and
   saved, because there is no Save button here and there should not be one. */
async function savePushKinds(kind, on) {
  const p = state.push;
  const next = PUSH_KIND_LABELS
    .map(function (pair) { return pair[0]; })
    .filter(function (k) { return k === kind ? on : p.kinds.indexOf(k) >= 0; });
  const before = p.kinds;
  p.kinds = next;
  try {
    const d = await API("push/prefs", { endpoint: p.endpoint, kinds: next });
    p.kinds = (d && d.kinds) || next;
  } catch (e) {
    p.kinds = before;
    throw e;
  }
}

/* Where a tapped notification lands. Deliberately addressed by the thing
   itself rather than by a notification id: the ids are worked out on the
   device from whatever the last sync held, and the server has no way to
   guess one that will still match by the time the tap happens. */
async function openPushTarget(spec) {
  const s = String(spec || "");
  const at = s.indexOf(":");
  const kind = at < 0 ? s : s.slice(0, at);
  const id = at < 0 ? "" : s.slice(at + 1);
  if (kind === "friends") { Actions.openFriends(); return; }
  /* A batch of recipes has no one page, so it opens the shelf they landed
     on, the same place accepting a friend request leaves you. */
  if (kind === "shelf") {
    let label = "";
    try { label = decodeURIComponent(id); } catch (e) { label = id; }
    state.ownerFilter = label || "ours";
    state.activeTags = [];
    state.notTags = [];
    state.search = "";
    state.view = "library";
    renderApp();
    return;
  }
  if (kind === "meal") {
    if (!mealById(id)) { toast("That meal is no longer there"); renderApp(); return; }
    state.view = "calendar";
    state.mealFocus = id;
    renderApp();
    scrollToMeal(id);
    return;
  }
  if (kind === "recipe" || kind === "cook") {
    if (!state.recipes.some(function (r) { return r.recipeId === id; })) {
      toast("That recipe is no longer there");
      renderApp();
      return;
    }
    /* A logged cook lands with the log already unfolded, the same as it does
       from the notifications page. */
    await Actions.openDetail(id, kind === "cook");
    return;
  }
  renderApp();
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

/* What other cookbooks have done with a recipe of yours. A tally and nothing
   else - naming them would turn a quiet compliment into a thing that has to
   be acknowledged, and the counts are per cookbook rather than per person
   because that is how a mark is stored. */
function MarkInterestHTML(r) {
  if (!r || !r.ours) return "";
  const c = state.markCounts[r.recipeId] || {};
  const parts = [];
  if (c.pin) parts.push(c.pin + " pinned it");
  if (c.star) parts.push(c.star + " favorited it");
  if (c.later) parts.push(c.later + " saved it for later");
  if (!parts.length) return "";
  return '<div class="mark-interest" title="Counted by cookbook. Which ones is not shown.">' +
    icon("users", 13) + '<span>' + esc(parts.join(" · ")) + '</span></div>';
}

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
  const tags = (r.tags || []).slice(0, 3).map(t => '<span class="tag">' + esc(t) + '</span>').join("");
  const badge = r.ours
    ? ((r.owner === state.session.username) ? "" : '<span class="owner-badge">' + esc(r.owner) + '</span>')
    : '<span class="owner-badge">' + esc(r.household) + '</span>';
  return '' +
    '<div class="rcard" role="button" tabindex="0" onclick="Actions.openDetail(\\'' + r.recipeId + '\\')">' +
      '<h3 class="font-display">' + esc(r.title) + '</h3>' +
      (r.description ? '<p class="desc">' + esc(r.description) + '</p>' : "") +
      '<div class="tag-row">' + badge + tags + '</div>' +
      '<div class="card-foot">' + ratingHTML(st.avg, st.count) +
        (st.cooks ? '<span class="cooked-count">· cooked ' + st.cooks + '×</span>' : "") +
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
/* Meals you are actually going to and could still bring something to: one
   you are hosting, or one you have said yes to. An invitation you have not
   answered is not a table you can put a dish on. */
function mealsIcanBringTo() {
  return state.meals.filter(function (m) {
    return !isMealPast(m) && (m.myStatus === "owner" || m.myStatus === "accepted");
  }).sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
}
/* Sits beside Schedule because it answers the same question - when is this
   being cooked - and only appears when there is a meal to answer it with. */
function MealMarkHTML(r, full) {
  if (!mealsIcanBringTo().length) return "";
  return '<button class="mark mark-cal" title="Add to a community meal" ' +
    'onclick="event.stopPropagation(); Actions.openMealAdd(\\'' + r.recipeId + '\\')">' +
    icon("users", full ? 15 : 14) + (full ? '<span>Add to Community Meal</span>' : "") +
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
  if (!state.activeTags.every(function (t) { return recipeHasTag(r, t); })) return false;
  return !(state.notTags || []).some(function (t) { return recipeHasTag(r, t); });
}
function filteredRecipes() {
  const q = state.search.trim().toLowerCase();
  const list = ownerFiltered().filter(r => {
    if (!matchesTags(r)) return false;
    if (!q) return true;
    const hay = [r.title, r.description, r.owner, r.household, r.ingNames].concat(r.tags || []).join(" ").toLowerCase();
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
  /* Most cooked means the cook log, not the number of people who have rated
     it. Reading the rating count here put a dish cooked twice below one
     cooked once, because ratings are one per cookbook and cooks are not. */
  else if (s === "cooked") arr.sort((a, b) => {
    const A = statsFor(a.recipeId), B = statsFor(b.recipeId);
    return (B.cooks - A.cooks) || ((B.avg || 0) - (A.avg || 0)) || a.title.localeCompare(b.title);
  });
  else if (s === "rated") arr.sort((a, b) => {
    const A = statsFor(a.recipeId), B = statsFor(b.recipeId);
    return ((B.avg || 0) - (A.avg || 0)) || (B.count - A.count) || a.title.localeCompare(b.title);
  });
  else arr.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return arr;
}
function hasActiveFilter() {
  return !!(state.search.trim() || state.activeTags.length || (state.notTags || []).length ||
    state.ownerFilter !== "all");
}

/* One screenful of scrolling, near enough. Small enough that a keystroke is
   cheap and large enough that most boxes never see the button. */
const PAGE_SIZE = 50;
function resultsKey() {
  return [state.search.trim().toLowerCase(), state.ownerFilter, state.sort]
    .concat(state.activeTags.slice().sort())
    .concat((state.notTags || []).slice().sort().map(function (t) { return "!" + t; }))
    .join("\\u0000");
}
/* Called from the one place that draws the results, so every route that
   narrows the box - the search field, a chip, the filter sheet, the household
   picker, the sort menu - resets the count without having to remember to. */
function syncShownCount() {
  const key = resultsKey();
  if (key !== state._shownKey) { state._shownKey = key; state.shown = PAGE_SIZE; }
  if (!state.shown) state.shown = PAGE_SIZE;
}

function ResultsSectionHTML() {
  syncShownCount();
  const results = filteredRecipes();
  const picked = state.activeTags.slice().sort(tagOrder);
  /* A banned tag is on nothing that is still showing, by definition, so it
     can never come back as a suggestion. It is pinned into the strip after
     the chosen ones instead, which is what keeps it switchable off. */
  const banned = (state.notTags || []).slice().sort(tagOrder);
  const offered = suggestedTags(results, picked.concat(banned));
  state._tagList = picked.concat(banned, offered);
  let chips = state._tagList.map((t, i) =>
    '<span class="chip' + (i < picked.length ? " active" : i < picked.length + banned.length ? " not" : "") +
      '" data-lp="tag:' + i + '" onclick="Actions.toggleTagAt(' + i + ')">' +
      esc(t) + '</span>'
  ).join("");
  if (picked.length + banned.length > 1) chips += '<span class="chip chip-clear" onclick="Actions.clearFilters()">Clear all</span>';
  let body;
  if (results.length === 0) {
    body = state.recipes.length === 0
      ? '<div class="empty-state"><p class="title font-display">Your cupboard is empty</p>' +
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
    const shown = Math.min(state.shown, results.length);
    const rest = results.length - shown;
    body = '<div class="grid-recipes">' +
      results.slice(0, shown).map(RecipeCardHTML).join("") + '</div>';
    if (rest > 0) {
      body += '<div class="load-more">' +
        '<button class="btn" onclick="Actions.showMore()">Load ' +
          Math.min(rest, PAGE_SIZE) + ' more</button>' +
        '<p class="load-more-count">Showing ' + shown + ' of ' + results.length + '</p>' +
      '</div>';
    }
  }
  /* Nothing chosen means no strip at all. The suggestions are a way of
     narrowing something down, not a menu to start from - that is what
     Inspiration is for - and three rows of them above an unfiltered shelf
     was three rows of noise. */
  const anyPick = picked.length + banned.length > 0;
  return (anyPick && state._tagList.length ? '<div class="chips">' + chips + '</div>' : "") + body;
}

function LibraryViewHTML() {
  /* The bell answers for notifications and the friends button for waiting
     requests, each carrying its own count. */
  const unread = unreadNotifications().length;
  const sortOptions = [["newest", "Newest first"], ["oldest", "Oldest first"], ["cooked", "Most cooked"],
    ["rated", "Highest rated"], ["az", "Title A–Z"], ["za", "Title Z–A"]]
    .map(o => '<option value="' + o[0] + '"' + (state.sort === o[0] ? " selected" : "") + '>' + o[1] + '</option>').join("");
  return '' +
    '<div class="wrap">' +
      '<div class="header">' +
        '<div class="header-brand">' +
          '<img class="brand-logo" src="/logo-v2.png" alt="Kindred Cupboard" />' +
          '<h1 class="sr-only">Kindred Cupboard</h1>' +
          '<button class="header-menu-btn" title="Menu" aria-label="Menu" ' +
            'onclick="Actions.openModal(\\'menu\\')">' + icon("menu", 24) + '</button>' +
        '</div>' +
        '<div class="header-row2">' +
          '<p class="header-who"><b>' + esc(state.session.username) + '</b> · ' +
            state.recipes.length + ' recipe' + (state.recipes.length === 1 ? "" : "s") + ' on the shelf</p>' +
          /* Three ways out of the header: who you cook with, what has come
             in, and something new on the shelf. Friends sits first because
             it is the one the other two are about. */
          '<div class="header-btns">' +
            '<button class="btn bell" title="Friends" aria-label="Friends" onclick="Actions.openFriends()">' + icon("users", 16) +
              (state.incoming.length ? '<span class="dot-badge">' + state.incoming.length + '</span>' : "") + '</button>' +
            '<button class="btn bell" title="Notifications" onclick="Actions.openNotifications()">' + icon("bell", 16) +
              (unread ? '<span class="dot-badge">' + unread + '</span>' : "") + '</button>' +
            '<button class="btn" title="New recipe" aria-label="New recipe" onclick="Actions.openNew()">' + icon("plus", 16) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="lib-grid">' +
        '<div class="search-field"><span class="icon">' + icon("search", 18) + '</span>' +
          '<input id="search-input" type="text" placeholder="Search" value="' + esc(state.search) + '" oninput="Actions.onSearchInput(this.value)" />' +
          '<button id="search-clear" class="search-clear' + (state.search ? " on" : "") + '" title="Clear search" onclick="Actions.clearSearch()">' + icon("x", 15) + '</button>' +
        '</div>' +
        '<select onchange="Actions.setSort(this.value)">' + sortOptions + '</select>' +
        '<button class="btn owner-pick" onclick="Actions.openModal(\\'owner\\')">' +
          icon("users", 14) + ' ' + esc(ownerFilterLabel()) + '</button>' +
        '<button id="filter-btn" class="' + FILTER_BTN_CLASS() + '" onclick="Actions.openFilters()">' +
          FilterButtonInnerHTML() +
        '</button>' +
      '</div>' +
      '<div id="results-section">' + ResultsSectionHTML() + '</div>' +
    '</div>';
}
function pickedTagCount() { return state.activeTags.length + (state.notTags || []).length; }
function FILTER_BTN_CLASS() {
  return "btn search-filter" + (pickedTagCount() ? " on" : "");
}
function FilterButtonInnerHTML() {
  return icon("sliders", 16) + '<span class="flabel">Inspiration</span>' +
    (pickedTagCount() ? '<span class="fcount">' + pickedTagCount() + '</span>' : "");
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
  el.className = FILTER_BTN_CLASS();
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
          '<span style="color:var(--sage);flex-shrink:0">' + icon("checklist", 17) + '</span>' +
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
/* Title on its own line, how many underneath it, and the two buttons down
   the right-hand side centred across both. A long recipe name used to squeeze
   the number box and the unit into nothing on a phone. */
function MealPickRowHTML(pick, servId, addOnclick, clearOnclick) {
  const unit = pick.unit || "servings";
  return '<div class="meal-dish-pick">' +
    '<span class="name">' + esc(pick.title) + '</span>' +
    '<span class="qty">' +
      '<input type="number" step="any" min="0" id="' + servId + '" ' +
        'aria-label="How many ' + esc(unit) + '" ' +
        'value="' + esc(String(pick.servings)) + '" />' +
      '<span class="unit">' + esc(unit) + '</span>' +
    '</span>' +
    '<button class="btn btn-sm btn-meal" onclick="' + addOnclick + '">' +
      icon("plus", 14) + ' Add</button>' +
    '<button class="icon-btn" title="Pick something else" ' +
      'onclick="' + clearOnclick + '">' + icon("x", 15) + '</button>' +
  '</div>';
}

function MealDishResultsHTML(m) {
  const q = String(state.mealDishSearch[m.mealId] || "");
  const picked = state.mealDishPick[m.mealId] || null;
  if (picked) {
    const counts = dishTitleCounts(m);
    const clash = counts[String(picked.title).trim().toLowerCase()] > 0;
    return (clash
      ? '<div class="meal-dup">Somebody is already bringing ' + esc(picked.title) +
          '. Add it anyway and the tile will read <b>Lots of ' + esc(picked.title) + '</b>.</div>'
      : "") +
      MealPickRowHTML(picked, "meal-serv-" + m.mealId,
        "Actions.addMealDish(\\'" + m.mealId + "\\')",
        "Actions.clearMealDishPick(\\'" + m.mealId + "\\')");
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
    const hay = [r.title, r.description, r.owner, r.household, r.ingNames]
      .concat(r.tags || []).join(" ").toLowerCase();
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
        '<button class="btn btn-sm btn-no meal-cancel" onclick="Actions.cancelMeal(\\'' + m.mealId + '\\')">' +
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
          /* A meal that has been eaten still sits on the page forever
             otherwise. Only the host can clear it, and it goes the same way
             a cancellation does - off everyone's calendar, not just ours. */
          (m.myStatus === "owner"
            ? '<div class="meal-actions">' +
                '<button class="btn btn-sm btn-no" onclick="Actions.cancelMeal(\\'' + m.mealId + '\\')">' +
                  icon("trash", 14) + ' Delete this meal</button>' +
              '</div>'
            : "") +
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
    const hay = [r.title, r.description, r.owner, r.household, r.ingNames]
      .concat(r.tags || []).join(" ").toLowerCase();
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
        /* Whose cookbook it is, and nothing else - the same subtitle the meal
           dish picker shows. The row used to print servings too, but a row in
           state.recipes is a library summary and the library payload has no
           servings on it, so reading r.servings.base threw on every keystroke
           and the results block silently rendered nothing at all. */
        '<div class="groc-entry-sub">' + esc(r.household) + '</div>' +
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
    (chained ? '<span style="color:var(--sage);flex-shrink:0">' + icon("chain", 16) + '</span>' : "") +
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
    '<p class="helper-text">Friendships link whole cookbooks. Add one person and you are linked to everyone who shares their cookbook, and they to everyone in yours. Recipes set to Private remain hidden.</p>' +
    '<div class="add-friend-row">' +
      '<input type="text" id="friend-name" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Their username" value="' + esc(state.friendPrefill || "") + '" />' +
      '<button class="btn btn-primary" onclick="Actions.sendFriendRequest()">' + icon("userPlus", 16) + ' Add</button>' +
      /* The code is the other half of the same row: type their name, or
         hold the phone up. It lives behind a button rather than sitting
         open, because it was taking a third of the page to say something
         you only need when somebody is standing in front of you. */
      '<button class="btn qr-open" onclick="Actions.openModal(\\'friendQr\\')">' + icon("qr", 15) + ' By QR</button>' +
    '</div>' +
    (mates ? '<div class="section-label">In your cookbook</div>' + mates : "") +
    '<div class="section-label">Requests for you</div>' + incoming +
    '<div class="section-label">Your friends</div>' + friends +
    (outgoing ? '<div class="section-label">Requests you sent</div>' + outgoing : "") +
    (declined ? '<div class="section-label">Declined</div>' + declined : "");

  return '' +
    '<div class="wrap">' +
      '<div class="detail-top">' +
        '<button class="back-link" onclick="Actions.backToLibrary()">' + icon("chevronLeft", 18) + ' Cupboard</button>' +
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
/* What used to sit open under the add-friend row. Nothing about it changed
   except where it lives: the code, and the sentence saying what happens to
   whoever scans it. */
function FriendQrModalHTML() {
  return modalShell("Add by QR",
    '<div class="qr-side">' +
      '<div class="qr-holder">' + friendQrHTML(state.session.username, 126) + '</div>' +
      '<div class="qr-side-text">' +
        '<p class="helper-text" style="margin:0">Opens Kindred Cupboard, sets them up with a cookbook if they need one, and then asks them to confirm sending <b>' +
          esc(state.session.username) + '</b> a friend request. You still have to accept it.</p>' +
      '</div>' +
    '</div>');
}

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
      /* The comment is set as a class rather than an inline colour so it
         follows the tile: white on an unread terracotta field, black once
         the tile has gone pale. A fixed grey read as neither. */
      line = '<b>' + esc(n.who) + '</b> cooked your <b>' + esc(n.title) + '</b>' +
        (n.comment ? '<br><span class="notif-said">' + esc(n.comment) + '</span>' : "");
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
      /* No Read/Unread label: the whole tile has always been the switch,
         and a button repeating what the colour already says was the third
         thing competing for the same corner. */
      '<div class="notif-acts">' + open + '</div>' +
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
  const r = summaryById(recipeId);
  state.watch = {
    recipeId,
    updatedAt: r ? r.updatedAt : null,
    /* The count comes from the library totals rather than from the log,
       because the log may not have been fetched yet and a null baseline
       would report the first poll as somebody else's cook. */
    comments: statsFor(recipeId).cooks
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
    action = '<button class="btn btn-sm" onclick="Actions.backToLibrary()">Back to the cupboard</button>';
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
/* Whether the custom chip is the live choice, and what it should read. Called
   wherever a scale is set from outside the servings row - opening a recipe
   off the calendar, moving a scheduled portion - so the chip never disagrees
   with the amounts underneath it. */
function syncCustomScale() {
  state.customScaleOpen = SCALE_PRESETS.indexOf(state.scale) < 0;
  if (state.customScaleOpen) state.customScale = trimNumber(state.scale);
}

/* One rating per cookbook, and only once that cookbook has actually made the
   thing. A verdict from a kitchen that has never cooked it is not a verdict,
   so the stars stay inert with a line saying what would wake them up. */
function RatingControlHTML(r) {
  const st = statsFor(r.recipeId);
  const allowed = st.ourCooks > 0;
  let stars = "";
  for (let n = 1; n <= 5; n++) {
    const filled = n <= st.mine ? "star-filled" : "star-empty";
    stars += allowed
      ? '<button type="button" class="icon-btn rate-star" title="' + n + ' star' + (n === 1 ? "" : "s") + '" ' +
        'onclick="Actions.setRating(' + n + ')">' + icon("star", 26, filled) + '</button>'
      : '<span class="rate-star">' + icon("star", 26, "star-empty") + '</span>';
  }
  const clear = (allowed && st.mine)
    ? '<button class="btn btn-sm btn-ghost" onclick="Actions.setRating(0)">Clear</button>' : "";
  const note = !allowed
    ? 'Log a cook and you can rate this one.'
    : (st.mine
        ? 'Your cookbook rates this ' + st.mine + ' out of 5. Tap to change it.'
        : 'Tap a star to rate this for your cookbook.');
  return '<div class="rate-section">' +
      '<div class="rate-row">' + stars + clear + '</div>' +
      '<p class="helper-text">' + note + '</p>' +
    '</div>';
}

function CookLogHTML(r) {
  const st = statsFor(r.recipeId);
  const ready = !!state.logs[r.recipeId] || hasBody(r);
  const list = commentsFor(r.recipeId).slice().sort((a, b) => String(b.cookedOn).localeCompare(String(a.cookedOn)));
  const shown = state._showAllLogs ? list : list.slice(0, 4);
  const me = state.session.username.toLowerCase();
  const items = !ready
    ? '<p class="no-rating">Loading the cook log…</p>'
    : list.length === 0
    ? '<p class="no-rating">Not cooked yet — log it after your first time through.</p>'
    : '<ul style="list-style:none;margin:0;padding:0">' + shown.map(c =>
        '<li class="log-item"><div style="min-width:0">' +
          '<div class="log-user">' + esc(c.username) + '</div>' +
          '<div class="log-date">' + esc(fmtDate(c.cookedOn)) + '</div>' +
          (c.comment ? '<p class="log-notes">' + esc(c.comment) + '</p>' : "") +
        '</div><div class="log-right">' +
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
      (st.cooks ? '<p class="helper-text">Cooked ' + st.cooks + ' time' + (st.cooks === 1 ? "" : "s") + '.</p>' : "") +
      items +
    '</div>';
}

/* hideLog suppresses the cook log for a reader who is not linked to the
   owner's cookbook. Ratings and comments stay between friends, so a recipe
   reached by a bare link shows the food and none of the conversation. */
function RecipeBodyHTML(r, hideLog) {
  /* The card's worth of a recipe is on screen already - name, description,
     tags. This is everything the cupboard tab deliberately does not carry,
     so on the first render of a recipe there is nothing here yet. */
  if (!hasBody(r)) {
    return '<div class="body-loading"><p class="no-rating">Loading the rest of this recipe…</p></div>' +
      (hideLog ? "" : RatingControlHTML(r) + CookLogHTML(r));
  }
  const scale = state.scale;
  const scaledServings = Math.round(r.servings.base * scale * 100) / 100;
  const m = r.macrosPerServing || {};

  const scaleBtns = SCALE_PRESETS.map(p =>
    '<button class="scale-btn ' + (!state.customScaleOpen && scale === p ? "active" : "") + '" onclick="Actions.setScale(' + p + ')">' + p + 'x</button>'
  ).join("");
  /* Typing into a chip the size of a fingernail never worked on a phone, so
     the chip is a door rather than a field: it opens a box, and afterwards it
     reads back whatever was accepted. The last accepted number stays on it
     even while a preset is live, so returning to 6x is one tap and a
     confirmation rather than a fresh guess. */
  const customTxt = state.customScaleOpen ? trimNumber(scale) : (state.customScale || "");
  const customChip = '<button class="scale-btn scale-custom' +
    (state.customScaleOpen ? " active" : "") + '" ' +
    'onclick="Actions.editCustomScale()">' +
    (customTxt ? esc(customTxt) + 'x' : "Custom") + '</button>';

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
        '<div class="scale-row">' + scaleBtns + customChip + '</div>' +
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
    (hideLog ? "" : RatingControlHTML(r) + CookLogHTML(r));
}

function DetailViewHTML(r) {
  if (!r) return '<div class="wrap"><p style="padding-top:30px">That recipe is no longer in your box.</p>' +
    '<button class="btn" onclick="Actions.backToLibrary()">Back to the cupboard</button></div>';
  const st = statsFor(r.recipeId);
  /* Share sits last, past Edit. The two that change the recipe are kept
     together and the one that sends it somewhere else closes the row. */
  const action = '<div class="detail-top-actions">' +
    CookModeButtonHTML() +
    (r.ours
      ? '<button class="btn btn-sm" onclick="Actions.openEdit(\\'' + r.recipeId + '\\')">' + icon("pencil", 14) + ' Edit</button>'
      : "") +
    ShareButtonHTML(r.recipeId, r.visibility) +
    '</div>';
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
    (st.cooks ? '<span class="cooked-count">cooked ' + st.cooks + '×</span>' : "") +
  '</div>';
  /* Who can see it sits with the other things you can do to the recipe. It
     and Pin are never both there: one is for a recipe of yours, the other
     for somebody else's. */
  const markRow = '<div class="detail-marks">' + MarkButtonsHTML(r, true) +
    (r.ours ? visibilityPill(r, true) : "") + '</div>';
  /* Its own row underneath, because it does something to the calendar rather
     than to the recipe and reads oddly sitting among the marks. */
  const schedRow = '<div class="detail-marks">' + ScheduleMarkHTML(r, true) + MealMarkHTML(r, true) + '</div>';
  /* Arrived here from a calendar square: say which one, and offer the way
     back out of it. The portions are already applied to the body below. */
  const sf = state.scheduledFor;
  const schedBanner = (sf && sf.recipeId === r.recipeId)
    ? '<div class="sched-banner">' + icon("calGrid", 15) +
        '<span>Scheduled for <b>' + esc(shortDate(sf.date)) + '</b> · <b>' + esc(String(sf.servings)) +
        '</b> ' + esc((r.servings && r.servings.unit) || "servings") + '</span>' +
        '<button class="btn btn-sm btn-no" style="margin-left:auto" onclick="Actions.unschedule(\\'' + sf.entryId + '\\')">' +
        icon("x", 13) + ' Unschedule</button>' +
      '</div>'
    : "";
  const tags = (r.tags || []).length
    ? '<div class="detail-tags">' + r.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join("") + '</div>'
    : "";
  const prov = r.mergedFrom
    ? '<div class="provenance">Copied from ' + esc(r.mergedFrom.username) + '\\'s cookbook on ' + esc(fmtDate(r.mergedFrom.date)) + '. Their ratings and comments stayed with the original.</div>'
    : "";
  return '' +
    '<div class="wrap">' +
      '<div class="detail-top">' +
        '<button class="back-link" onclick="Actions.backToLibrary()">' + icon("chevronLeft", 18) + ' Cupboard</button>' +
        action +
      '</div>' +
      '<div id="change-banner">' + ChangeBannerHTML() + '</div>' +
      '<h1 class="detail-title font-display">' + esc(r.title) + '</h1>' +
      /* The card already carried this and the recipe page did not, which was
         tolerable while the body arrived with the page. Now that the body
         comes second, it is one of the few things there is to read while the
         rest is on its way. */
      (r.description ? '<p class="detail-desc">' + esc(r.description) + '</p>' : "") +
      creditRow +
      MarkInterestHTML(r) +
      schedBanner +
      markRow +
      schedRow +
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
          '<button class="icon-btn" id="ing-down-' + idx + '" ' + (idx === total - 1 ? "disabled" : "") + ' onclick="Actions.moveIngredient(' + idx + ',1)">' + icon("chevronDown", 15) + '</button>' +
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
        '<button class="icon-btn" id="step-down-' + idx + '" ' + (idx === total - 1 ? "disabled" : "") + ' onclick="Actions.moveStep(' + idx + ',1)">' + icon("chevronDown", 15) + '</button>' +
      '</div>' +
      '<button class="icon-btn" onclick="Actions.removeStep(' + idx + ')">' + icon("x", 16) + '</button>' +
    '</div>';
}

/* Five ways in. Four of them are the same shape - get a prompt, run it
   wherever you keep your AI, paste the answer back - and the fifth is the
   bulk JSON reader. One button opens the menu; the menu swaps the sheet's
   own body for whichever one you pick, with a way back. */
const IMPORT_ORDER = ["url", "text", "photo", "chat", "json"];
/* Asked before the form opens rather than offered from inside it. The two
   are weighed the same: one fills the form in from something you already
   have, the other hands you an empty one. */
function NewRecipeModalHTML() {
  return modalShell("New recipe",
    '<p class="helper-text">Where is this one coming from?</p>' +
    '<div style="display:flex; flex-direction:column; gap:8px;">' +
      '<button class="btn btn-block" onclick="Actions.openImportPrompt()">' +
        icon("upload", 16) + ' Import Recipe</button>' +
      '<button class="btn btn-primary btn-block" onclick="Actions.startBlankRecipe()">' +
        icon("pencil", 16) + ' Write my Own Recipe</button>' +
    '</div>');
}
function ImportMenuHTML() {
  return '<p class="helper-text">Where is the recipe coming from? Whichever you pick fills in the ' +
    'new-recipe form, so you can check it over before it saves.</p>' +
    '<div class="import-menu">' +
    IMPORT_ORDER.map(function (mode) {
      const s = IMPORT_SOURCES[mode];
      return '<button class="btn import-choice" onclick="Actions.pickImportMode(\\'' + mode + '\\')">' +
        icon(s.icon, 16) + '<span>' + s.label + '</span></button>';
    }).join("") + '</div>';
}
function ImportBackLinkHTML() {
  return '<button class="back-link import-back" onclick="Actions.backToImportMenu()">' +
    icon("chevronLeft", 16) + ' All import options</button>';
}

/* A row is blank when nothing has been typed into it. The unit menus are
   deliberately not consulted: an ingredient that is only a "tbsp" is not an
   ingredient, and a step that is only a timer is not a step. */
function blankIngredient() {
  return { name: "", metricValue: "", metricUnit: "g", customaryValue: "", customaryUnit: "cup", notes: "" };
}
function blankStep() { return { text: "", timerMinutes: "" }; }
function ingredientIsBlank(i) {
  return !String((i && i.name) || "").trim() && String((i && i.metricValue) || "") === "" &&
    String((i && i.customaryValue) || "") === "" && !String((i && i.notes) || "").trim();
}
function stepIsBlank(s) {
  return !String((s && s.text) || "").trim() && String((s && s.timerMinutes) || "") === "";
}
/* There is always one empty row waiting at the bottom of each list, which is
   what replaced the Add buttons. Idempotent, so calling it on every render
   never grows the form on its own. */
function ensureTrailingBlankRows(d) {
  if (!d) return;
  if (!d.ingredients.length || !ingredientIsBlank(d.ingredients[d.ingredients.length - 1])) {
    d.ingredients.push(blankIngredient());
  }
  if (!d.steps.length || !stepIsBlank(d.steps[d.steps.length - 1])) d.steps.push(blankStep());
}
function stripBlankRows(d) {
  d.ingredients = d.ingredients.filter(i => !ingredientIsBlank(i));
  d.steps = d.steps.filter(s => !stepIsBlank(s));
}

function EditViewHTML() {
  const d = state.editDraft;
  ensureTrailingBlankRows(d);
  const isNew = state.editIsNew;
  const ingredientsHTML = d.ingredients.map((ing, idx) => IngredientRowHTML(ing, idx, d.ingredients.length)).join("");
  const stepsHTML = d.steps.map((s, idx) => StepRowHTML(s, idx, d.steps.length)).join("");
  return '' +
    '<div class="wrap">' +
      '<div class="detail-top">' +
        '<button class="back-link" onclick="Actions.cancelEdit()">' + icon("chevronLeft", 18) + ' Cancel</button>' +
        '<div class="edit-actions">' +
          /* Nothing on a new recipe: importing is asked about before the
             form opens, and a button that would overwrite everything typed
             so far has no business sitting next to Save. */
          (isNew
            ? ""
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
      '<div class="subhead-row"><span class="small-label">Ingredients</span></div>' +
      '<div id="ingredients-container" oninput="Actions.growIngredients()" onchange="Actions.growIngredients()">' + ingredientsHTML + '</div>' +
      '<div class="subhead-row" style="margin-top:16px"><span class="small-label">Steps</span></div>' +
      '<div id="steps-container" oninput="Actions.growSteps()" onchange="Actions.growSteps()">' + stepsHTML + '</div>' +
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
    '<div class="pick-list">' + (rows.join("") || '<p class="helper-text">No one by that name.</p>') + '</div>',
    "modal-tile");
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
  const on = l => tagPickState(l) !== "";
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
  const chosen = l => tagPickState(l) !== "";
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
    const st = tagPickState(label);
    return '<button class="fbox' + (extra || "") + (st === "on" ? " on" : st === "not" ? " not" : "") +
      '" data-fb="' + i + '" data-lp="filter:' + i + '" onclick="Actions.toggleFilterAt(' + i + ')">' +
      esc(shown || label) + '</button>';
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
  const html = modalShell("Get Inspired",
    '<div class="filter-scroll"><div class="filter-body" onscroll="updateFilterScrollHint()">' +
      body + '</div></div>' +
    '<div class="edit-actions">' +
      '<button class="btn" onclick="Actions.clearFilters()">Clear selected tags</button>' +
      '<button class="btn btn-primary" onclick="Actions.closeModal()">Done</button>' +
    '</div>',
    "modal-tile");
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
  const els = root.querySelectorAll("[data-fb]");
  for (let j = 0; j < els.length; j++) {
    const label = list[Number(els[j].getAttribute("data-fb"))];
    if (label === undefined) continue;
    const st = tagPickState(label);
    els[j].classList.toggle("on", st === "on");
    els[j].classList.toggle("not", st === "not");
  }
}
function updateFilterCounts() {
  const root = document.querySelector(".filter-body");
  if (!root) return;
  const list = state._badgeList || [];
  const on = l => tagPickState(l) !== "";
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
  if (!state.friends.length) {
    return '<p class="helper-text">Only your cookbook can see this. Add a friend and you will be able to hand it to them individually.</p>';
  }
  return '<p class="helper-text" style="margin-top:10px">Only your cookbook and the friends you tick here. They can open it by link or code.</p>' +
    ShareFriendPickerHTML(d._shareWith || [], "Actions.toggleShare",
      "Actions.shareSearchForm", "share-form");
}

/* The friend list both Selective share pickers draw, lifted from the meal
   guest list: a search field over three rows of scroller, everybody you have
   already ticked collected at the top so a long list does not leave you
   scrolling to check who is on. The index handed to the toggle is the index
   into state.friends, not into the sorted rows, so reordering the list never
   changes who a tap picks. */
function ShareFriendPickerHTML(chosen, toggleCall, searchCall, idbase) {
  const q = (state.shareFriendSearch || "").trim().toLowerCase();
  const picked = {};
  (chosen || []).forEach(function (k) { picked[String(k).toLowerCase()] = 1; });
  const isOn = function (f) { return !!picked[(f.members[0] || "").toLowerCase()]; };
  const ordered = state.friends.map(function (f, i) { return { f: f, i: i }; })
    .sort(function (a, b) {
      return ((isOn(a.f) ? 0 : 1) - (isOn(b.f) ? 0 : 1)) ||
        a.f.label.localeCompare(b.f.label, undefined, { sensitivity: "base" });
    });
  const rows = ordered.map(function (o) {
    const key = o.f.members[0] || "";
    if (!key) return "";
    if (q && o.f.label.toLowerCase().indexOf(q) < 0) return "";
    return '<button class="pick-row pick-row-solid' + (isOn(o.f) ? " on" : "") + '" ' +
      'onclick="' + toggleCall + '(' + o.i + ')">' +
      esc(o.f.label) +
      (o.f.members.length > 1
        ? '<div class="friend-sub">One cookbook — all of them can see it</div>' : "") +
    '</button>';
  }).join("");
  return '<input type="text" id="' + idbase + '-search" autocomplete="off" ' +
      'placeholder="Search friends..." value="' + esc(state.shareFriendSearch || "") + '" ' +
      'oninput="' + searchCall + '(this.value)" />' +
    '<div class="pick-list pick-list-3" id="' + idbase + '-list">' +
      (rows || '<p class="helper-text">No one by that name.</p>') + '</div>';
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

function modalShell(title, inner, cls) {
  return '<div class="modal-overlay" onclick="if(event.target===this)Actions.closeModal()"><div class="modal-box' +
    (cls ? " " + cls : "") + '">' +
    '<div class="modal-head"><h3 class="font-display">' + title + '</h3>' +
    '<button class="modal-close" onclick="Actions.closeModal()">' + icon("x", 20) + '</button></div>' +
    (state.modalError ? '<div class="modal-error">' + esc(state.modalError) + '</div>' : "") +
    inner + '</div></div>';
}

/* The multiplier the presets do not cover. A number and two answers - nothing
   about the recipe changes until Accept is pressed, so a box opened by
   accident costs a tap to dismiss and nothing else. */
function CustomScaleModalHTML() {
  const r = getActiveRecipe();
  const unit = (r && r.servings && r.servings.unit) || "servings";
  return modalShell("Custom servings",
    '<p class="helper-text">How many times the recipe? The ingredients and the ' +
      esc(unit) + ' below follow whatever you put here.</p>' +
    '<div class="field"><label>Multiplier</label>' +
      '<input type="text" id="scale-custom" inputmode="decimal" autocomplete="off" ' +
        'placeholder="e.g. 6" aria-label="Custom multiplier" ' +
        'value="' + esc(state._scaleDraft || "") + '" ' +
        'oninput="Actions.scaleDigitsOnly(this)" ' +
        'onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();Actions.commitCustomScale();}" /></div>' +
    '<div class="edit-actions"><button class="btn" onclick="Actions.cancelCustomScale()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="Actions.commitCustomScale()">Accept</button></div>');
}

function LogCookModalHTML() {
  const r = getActiveRecipe();
  return modalShell("Log this cook",
    '<p class="helper-text">' + esc(r ? r.title : "") + ' — log it as often as you cook it. ' +
    'The comment is optional, and how your cookbook rates the dish is set on the recipe itself.</p>' +
    '<div class="field"><label>Date cooked</label><input type="date" id="cl-date" value="' + todayStr() + '" /></div>' +
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
  const base = (r.servings && Number(r.servings.base) > 0) ? Number(r.servings.base) : 1;
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
      esc(r.servings.unit) + '. Set the day and the number below; the shopping list follows.</p>' +
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
    '<div class="step-block"><button class="ing-toggle" aria-expanded="' +
      (state.schedIngOpen ? "true" : "false") + '" onclick="Actions.toggleSchedIng()">' +
      icon(state.schedIngOpen ? "chevronDown" : "chevronUp", 15) +
      '<span>Ingredients at ' + serv + ' ' + esc(r.servings.unit) + '</span></button>' +
      (state.schedIngOpen ? ing : "") + '</div>' +
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
    const clash = dr.dishes.filter(function (d) {
      return d.title.trim().toLowerCase() === pick.title.trim().toLowerCase();
    }).length;
    return (clash
      ? '<div class="meal-dup">You already have ' + esc(pick.title) + ' on the list.</div>' : "") +
      MealPickRowHTML(pick, "meal-serv-draft",
        "Actions.addMealDraftDish()", "Actions.clearMealDishPick(\\'draft\\')");
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
  /* Everyone you have ticked collects at the top, alphabetically, so a long
     friend list does not leave you scrolling to check who is already on. The
     ones the meal has settled already sit at the bottom, since they are
     there to be read rather than tapped. */
  const rank = function (f) {
    const key = (f.members[0] || "").toLowerCase();
    if (already && already[f.label]) return 2;
    return picked[key] ? 0 : 1;
  };
  const ordered = state.friends.slice().sort(function (a, b) {
    return (rank(a) - rank(b)) ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
  const rows = ordered.map(function (f) {
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
    '<div class="pick-list pick-list-3" id="meal-friend-list">' +
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
        '<input type="date" id="meal-date" min="' + esc(localToday()) + '" value="' + esc(dr.date) + '" /></div>' +
      '<div class="field"><label>Time</label>' +
        '<input type="time" id="meal-time" value="' + esc(dr.time) + '" /></div>' +
    '</div>' +
    /* Editing has its own Invite more button on the tile, so the whole
       picker would be a second way to do one thing. */
    (editing
      ? ""
      : '<div class="step-block"><div class="step-label">Who to invite</div>' +
          MealFriendPickerHTML(null) +
        '</div>') +
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

/* Which table, and how much of it you are bringing. The same two questions
   the sign-up box on a tile asks, reached from the recipe instead. */
function MealAddModalHTML() {
  const d = state.mealAdd;
  const meals = mealsIcanBringTo();
  if (!d || !meals.length) return modalShell("Add to Community Meal", "");
  const r = recipeById(d.recipeId);
  const unit = d.unit || "servings";
  const chosen = meals.filter(function (m) { return m.mealId === d.mealId; })[0] || meals[0];
  const clash = chosen && chosen.dishes.filter(function (x) {
    return String(x.title).trim().toLowerCase() === String(d.title || "").trim().toLowerCase();
  }).length;
  return modalShell("Add to Community Meal",
    '<p class="helper-text">' + esc(d.title || (r ? r.title : "This recipe")) +
      ' — it lands on the table and on your own calendar for that day.</p>' +
    '<div class="field"><label>Which meal</label>' +
      '<select id="meal-add-pick" onchange="Actions.setMealAddMeal(this.value)">' +
        meals.map(function (m) {
          return '<option value="' + esc(m.mealId) + '"' +
            (chosen && m.mealId === chosen.mealId ? " selected" : "") + '>' +
            esc(m.title) + ' — ' + esc(shortDate(m.date)) + '</option>';
        }).join("") +
      '</select></div>' +
    '<div class="field"><label>How many ' + esc(unit) + '</label>' +
      '<input type="number" step="any" min="0" id="meal-add-serv" value="' + esc(String(d.servings)) + '" /></div>' +
    (clash
      ? '<div class="meal-dup">Somebody is already bringing ' + esc(d.title) +
          '. Add it anyway and the tile will read <b>Lots of ' + esc(d.title) + '</b>.</div>'
      : "") +
    '<div class="edit-actions">' +
      '<button class="btn" onclick="Actions.closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="Actions.confirmMealAdd()">' +
        icon("plus", 15) + ' Add</button>' +
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
  return modalShell("Import recipes", ImportModalBodyHTML());
}
function ImportModalBodyHTML() {
  const parsed = state.importParsed;
  let summary = "";
  if (parsed.length || state.importErrors.length) {
    summary = '<div class="import-summary">' +
      '<div>' + parsed.length + ' recipe(s) read.</div>' +
      (state.importErrors.length ? '<div style="color:var(--danger);margin-top:4px">' + icon("alert", 13) +
        ' Couldn\\'t read line(s) ' + state.importErrors.join(", ") + ' — usually curly “smart quotes” from a keyboard or notes app.</div>' : "") +
      (parsed.length ? '<ul>' + parsed.map(p => '<li>' + esc(p.body.title) + '</li>').join("") + '</ul>' : "") +
    '</div>';
  }
  return '' +
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
      ' onclick="Actions.confirmImport()">Import ' + (parsed.length || "") + ' recipe' + (parsed.length === 1 ? "" : "s") + '</button>';
}

function UrlToRecipeModalHTML() {
  const u = state.urlToRecipe;
  if (!u.mode) return modalShell("Import", ImportMenuHTML());
  if (u.mode === "json") return modalShell("From JSON", ImportBackLinkHTML() + ImportModalBodyHTML());
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
    ImportBackLinkHTML() +
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

/* One switch, per device, with the reason underneath whenever it cannot be
   thrown. Nothing here is per cookbook: a phone is a phone. */
function PushSettingHTML() {
  const p = state.push;
  const line = function (text) { return '<p class="helper-text">' + text + '</p>'; };
  let inner;
  if (p.status === "install") {
    inner = line("On an iPhone or iPad, notifications only work once the app is on your Home Screen. " +
      "Tap Share, then Add to Home Screen, and open it from there.");
  } else if (p.status === "denied") {
    inner = line("Notifications are blocked for this app in your device settings. Turn them back on there first.");
  } else if (p.status === "unavailable") {
    inner = line("Notifications are not switched on for this server yet.");
  } else if (p.status === "unsupported" || p.status === "unknown") {
    inner = line("This browser cannot send notifications.");
  } else {
    const on = p.status === "on";
    inner = '<button class="btn btn-sm btn-block' + (on ? "" : " btn-primary") + '" ' +
      (p.busy ? "disabled" : "") + ' onclick="Actions.togglePush()">' +
      icon("bell", 14) + " " + (p.busy ? "Working…" : (on ? "Turn off on this device" : "Turn on for this device")) +
      '</button>' +
      (on
        ? '<p class="helper-text" style="margin-bottom:2px">This device is signed up. Choose what it tells you about:</p>' +
          PUSH_KIND_LABELS.map(function (pair) {
            const checked = p.kinds.indexOf(pair[0]) >= 0;
            return '<label class="check-row"><input type="checkbox"' + (checked ? " checked" : "") +
              (p.busy ? " disabled" : "") +
              ' onchange="Actions.setPushKind(this.value, this.checked)" value="' + pair[0] + '" />' +
              '<span>' + esc(pair[1]) + '</span></label>';
          }).join("") +
          (p.kinds.length ? "" :
            '<p class="helper-text">Everything is switched off, so nothing will reach this device. ' +
            'Turn one back on, or turn notifications off altogether.</p>')
        : line("Hear about friend requests, meal invitations, replies to your invitations, cooks logged on your recipes, and recipes your friends share — without the app open."));
  }
  return '<div class="field"><label>Notifications</label>' + inner + '</div>';
}

function AccountModalHTML() {
  return modalShell("Settings",
    '<div class="field"><label>Email</label>' +
      '<div class="code-box" style="font-size:14px; letter-spacing:0">' + esc(state.session.email || "—") + '</div>' +
      '<p class="helper-text">This is what you sign in with. It is never shown to anyone else using the app.</p>' +
    '</div>' +
    '<div style="display:flex; gap:8px; margin-bottom:18px">' +
      '<button class="btn btn-sm" onclick="Actions.openModal(\\'changePassword\\')">' + icon("lock", 14) + ' Change password</button>' +
      '<button class="btn btn-sm" onclick="Actions.openModal(\\'changeEmail\\')">' + icon("pencil", 14) + ' Change email</button>' +
    '</div>' +
    '<div class="field"><label>Your name</label>' +
      '<input type="text" id="set-name" autocapitalize="words" autocorrect="off" spellcheck="false" value="' + esc(state.session.username) + '" />' +
      '<button class="btn btn-sm btn-block" onclick="Actions.saveUsername()">Save name</button>' +
      '<p class="helper-text">This is what friends see on your recipes, ratings and comments. 2-25 characters: letters, numbers, spaces, dot, dash or underscore.</p>' +
    '</div>' +
    PushSettingHTML() +
    (state.mates.length
      ? '<div class="field"><label>In this cookbook with you</label>' +
        state.mates.map(m => '<div class="friend-row"><span style="color:var(--sage)">' + icon("chain", 16) + '</span>' +
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
      '<p class="helper-text" style="margin-top:14px">Temporary password. The address and the password are turned into a ' +
        'hash here, in this browser, before either is sent — the server never sees the password itself. ' +
        'It signs every one of their devices out.</p>' +
      '<div class="field"><label>Their email address</label>' +
        '<input type="email" id="adm-email" autocapitalize="none" autocorrect="off" spellcheck="false" /></div>' +
      '<div class="field"><label>Temporary password</label>' +
        '<input type="text" id="adm-temp" autocapitalize="none" autocorrect="off" spellcheck="false" /></div>' +
      '<button class="btn btn-sm" onclick="Actions.adminSetPassword()">Set temporary password</button>' +
    '</details>' +
    '<button class="btn btn-block" onclick="Actions.signOut()">' + icon("logout", 15) + ' Sign out on this device</button>');
}

function ChangePasswordModalHTML() {
  return modalShell("Change password",
    '<p class="helper-text">Your current password, then the new one twice. Every other device you are signed in on will be signed out.</p>' +
    '<div class="field"><label>Current password</label>' +
      '<input type="password" id="cp-current" autocomplete="current-password" /></div>' +
    '<div class="field"><label>New password</label>' +
      '<input type="password" id="cp-new" autocomplete="new-password" /></div>' +
    '<div class="field"><label>New password again</label>' +
      '<input type="password" id="cp-new2" autocomplete="new-password" /></div>' +
    '<div class="edit-actions"><button class="btn" onclick="Actions.closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" ' + (state._acctBusy ? "disabled" : "") +
      ' onclick="Actions.changePassword()">' + (state._acctBusy ? "Working…" : "Change password") + '</button></div>');
}

function ChangeEmailModalHTML() {
  return modalShell("Change email",
    '<p class="helper-text">Your current address, the new one, and your password. Every other device you are signed in on will be signed out.</p>' +
    '<div class="field"><label>Current email</label>' +
      '<input type="email" id="ce-current" autocapitalize="none" autocorrect="off" spellcheck="false" /></div>' +
    '<div class="field"><label>New email</label>' +
      '<input type="email" id="ce-new" autocapitalize="none" autocorrect="off" spellcheck="false" /></div>' +
    '<div class="field"><label>Password</label>' +
      '<input type="password" id="ce-pass" autocomplete="current-password" /></div>' +
    '<div class="edit-actions"><button class="btn" onclick="Actions.closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" ' + (state._acctBusy ? "disabled" : "") +
      ' onclick="Actions.changeEmail()">' + (state._acctBusy ? "Working…" : "Change email") + '</button></div>');
}

function ContactModalHTML() {
  return modalShell("Contact info",
    '<p class="helper-text">Questions, bug reports, or a password you cannot get back — write in and we will answer.</p>' +
    '<div class="code-box" style="font-size:15px; letter-spacing:0">' +
      '<a href="mailto:' + SUPPORT_EMAIL + '">' + SUPPORT_EMAIL + '</a></div>' +
    '<button class="btn btn-block" onclick="Actions.copySupportEmail()">' + icon("copy", 15) + ' Copy address</button>' +
    '<p class="helper-text" style="margin-top:14px">For a lost password, write from the address on your account. There is no automatic reset — a temporary password is sent back by hand.</p>');
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
  const picker = v !== "selective" ? "" :
    (!state.friends.length
      ? '<p class="helper-text">No friends yet, so there is nobody to hand it to. It stays inside your cookbook until you add one.</p>'
      : '<div class="section-label">Hand it to</div>' +
        ShareFriendPickerHTML(state.visDraft || [], "Actions.toggleVisShare",
          "Actions.shareSearchSheet", "vis-share"));
  return modalShell("Who can see this",
    '<div class="vis-rows">' +
      row("private", "Only your cookbook. No link and no code — this one does not leave the house.") +
      row("selective", "Your cookbook, plus the friends you tick. Can be handed out by link or code.") +
      row("friends", "Every friend of your cookbook. Can be handed out by link or code.") +
    '</div>' + picker,
    "modal-tile");
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
    ? '<button class="back-link" onclick="Actions.leaveLinkView()">' + icon("chevronLeft", 18) + ' Cupboard</button>'
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
      '<div class="detail-top">' + back +
        '<div class="detail-top-actions">' + CookModeButtonHTML() +
          ShareButtonHTML(lr.recipeId, lr.visibility) + '</div>' +
      '</div>' +
      '<h1 class="detail-title font-display">' + esc(r.title) + '</h1>' +
      '<div class="detail-meta" style="margin-bottom:10px">' + credit + '</div>' +
      pinRow +
      joinRow +
      tags +
      '<div id="recipe-body">' + RecipeBodyHTML(r, true) + '</div>' +
    '</div>';
}

/* Link and code, side by side, carrying the same URL. Private recipes get
   neither: there is nothing to hand out, and offering a code for something
   nobody else can open would only mislead. */
/* The body of the share frame: the address, a way to copy it, and the code
   somebody can point a camera at. It used to sit inline in the middle of the
   recipe, which put a QR code between the reader and the ingredients on every
   single recipe. Behind a button it is there when it is wanted and out of the
   way when it is not. */
function ShareBlockHTML(recipeId) {
  const shareUrl = recipeQrUrl(recipeId);
  return '<div class="qr-share" style="margin:2px 0 4px">' +
      '<div class="qr-side-text">' +
        '<div class="code-box font-mono">' + esc(shareUrl) + '</div>' +
        '<button class="btn btn-sm btn-block" onclick="Actions.copyRecipeUrl(\\'' + recipeId + '\\')">' +
          icon("copy", 14) + ' Copy link</button>' +
      '</div>' +
      '<div class="qr-holder">' + recipeQrHTML(recipeId, 112) + '</div>' +
    '</div>';
}

function ShareRecipeModalHTML() {
  const id = state.shareId;
  if (!id) return modalShell("Share Recipe", '<p class="helper-text">Nothing to share.</p>');
  return modalShell("Share Recipe",
    '<p class="helper-text">Anyone with this link or code can read the recipe. ' +
    'What they can do with it beyond reading depends on whether they have a cookbook.</p>' +
    ShareBlockHTML(id));
}

/* Only a recipe somebody else could actually reach has a link. Rather than
   the button coming and going, it greys: a dead Share button says "this one
   is private" more plainly than a sentence underneath the title did, and the
   corner keeps the same shape from one recipe to the next. */
function ShareButtonHTML(recipeId, visibility) {
  const shareable = visibility === "friends" || visibility === "selective";
  return '<button class="icon-btn share-btn" title="' +
    (shareable ? "Share this recipe" : "This recipe is private - change who can see it to share it") + '"' +
    (shareable ? ' onclick="Actions.openShare(\\'' + recipeId + '\\')"' : " disabled") + '>' +
    icon("shareIos", 19) + '</button>';
}

/* Cook mode holds a screen wake lock so a propped-up iPad stops dimming
   halfway through the method. Where the browser has no such thing there is
   nothing to offer, so the button is left out rather than drawn dead - unlike
   Share, which is dead for a reason the reader can act on. */
function CookModeButtonHTML() {
  if (!wakeLockSupported()) return "";
  const on = !!state.cookMode;
  return '<button class="mark cook-btn' + (on ? " on" : "") + '" title="' +
    (on ? "Cook mode on - the screen will not dim or lock" :
          "Cook mode - keep the screen awake while you cook") + '" ' +
    'onclick="Actions.toggleCookMode()">' + icon("flame", 15) + '<span>Cook</span></button>';
}

/* The menu behind the three bars in the header. Everything that used to be
   a stack of full-width buttons in the Actions sheet, laid out as tiles: an
   icon with its name under it, two to a row. New recipe stays on it even
   though the header carries a plus of its own - the menu is the list of
   everything there is to do, and leaving one thing off it because there is
   a shortcut elsewhere makes the list less answerable, not shorter. */
const MENU_TILES = [
  ["plus", "New recipe", "Actions.openNew()", "none"],
  ["users", "Friends", "Actions.openFriends()", "requests"],
  ["bell", "Notifications", "Actions.openNotifications()", "unread"],
  ["sync", "Refresh", "Actions.reload()", "none"],
  ["share", "Share App", "Actions.openModal(\\'shareApp\\')", "none"],
  ["gear", "Settings", "Actions.openModal(\\'account\\')", "none"],
  ["info", "Contact Info", "Actions.openModal(\\'contact\\')", "none"]
];
function menuTileCount(kind) {
  if (kind === "requests") return state.incoming.length;
  if (kind === "unread") return unreadNotifications().length;
  return 0;
}
function MenuDrawerHTML() {
  const tiles = MENU_TILES.map(function (t) {
    const n = menuTileCount(t[3]);
    return '<button class="tile" onclick="Actions.closeModal(); ' + t[2] + ';">' +
      icon(t[0], 26) +
      '<span>' + t[1] + '</span>' +
      (n ? '<span class="dot-badge">' + n + '</span>' : "") +
    '</button>';
  }).join("");
  return '<div class="modal-overlay drawer-overlay" onclick="if(event.target===this)Actions.closeModal()">' +
    '<div class="drawer-panel">' +
      '<div class="modal-head"><h3 class="font-display">Menu</h3>' +
      '<button class="modal-close" onclick="Actions.closeModal()">' + icon("x", 20) + '</button></div>' +
      '<div class="tile-grid">' + tiles + '</div>' +
    '</div></div>';
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
   white under rgba(42,35,32,.5) is #918b86. Elsewhere the tag only tints
   browser chrome that is already the right colour, so this costs nothing. */
const CHROME_REST = "#ffffff";
const CHROME_DIMMED = "#918b86";
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
  if (state.modal === "customScale") root.innerHTML = CustomScaleModalHTML();
  else if (state.modal === "logCook") root.innerHTML = LogCookModalHTML();
  else if (state.modal === "import") root.innerHTML = ImportModalHTML();
  else if (state.modal === "urlToRecipe") root.innerHTML = UrlToRecipeModalHTML();
  else if (state.modal === "account") root.innerHTML = AccountModalHTML();
  else if (state.modal === "changePassword") root.innerHTML = ChangePasswordModalHTML();
  else if (state.modal === "changeEmail") root.innerHTML = ChangeEmailModalHTML();
  else if (state.modal === "contact") root.innerHTML = ContactModalHTML();
  else if (state.modal === "shareApp") root.innerHTML = ShareAppModalHTML();
  else if (state.modal === "share") root.innerHTML = ShareRecipeModalHTML();
  else if (state.modal === "confirmIntent") root.innerHTML = ConfirmIntentModalHTML();
  else if (state.modal === "visibility") root.innerHTML = VisibilityModalHTML();
  else if (state.modal === "owner") root.innerHTML = OwnerModalHTML();
  else if (state.modal === "filters") { root.innerHTML = FiltersModalHTML(); updateFilterScrollHint(); }
  else if (state.modal === "menu") root.innerHTML = MenuDrawerHTML();
  else if (state.modal === "friendQr") root.innerHTML = FriendQrModalHTML();
  else if (state.modal === "newRecipe") root.innerHTML = NewRecipeModalHTML();
  else if (state.modal === "schedule") root.innerHTML = ScheduleModalHTML();
  else if (state.modal === "calDay") root.innerHTML = CalDayModalHTML();
  else if (state.modal === "confirmDeleteList") root.innerHTML = ConfirmDeleteListModalHTML();
  else if (state.modal === "addGroceryItem") root.innerHTML = AddGroceryItemModalHTML();
  else if (state.modal === "renameList") root.innerHTML = RenameListModalHTML();
  else if (state.modal === "groceryHelp") root.innerHTML = GroceryHelpModalHTML();
  else if (state.modal === "groceriesHelp") root.innerHTML = GroceriesHelpModalHTML();
  else if (state.modal === "calendarHelp") root.innerHTML = CalendarHelpModalHTML();
  else if (state.modal === "meal") root.innerHTML = MealModalHTML();
  else if (state.modal === "mealAdd") root.innerHTML = MealAddModalHTML();
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
  endCookModeIfAway();
  /* A share link is readable before there is an account, so this comes ahead
     of the sign-in wall rather than behind it. */
  if (state.view === "link") {
    app.innerHTML = LinkRecipeViewHTML();
    renderTabBar();
    renderModal();
    topOnNewRecipe();
    return;
  }
  if (!state.session) { app.innerHTML = WelcomeViewHTML(); renderTabBar(); renderModal(); return; }
  /* Deliberately the same markup the shell painted, so the only thing that
     changes between the two is the line underneath. */
  if (state.loading) {
    app.innerHTML = '<div class="boot-splash"><img src="/logo-v2.png" alt="Kindred Cupboard" />' +
      '<div class="boot-say">Loading your cupboard…</div></div>';
    renderTabBar(); renderModal(); return;
  }
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
  topOnNewRecipe();
}

/* Which recipe the page is currently showing, so a repaint can be told apart
   from an arrival. Null whenever the view is not a recipe at all. */
let shownRecipeKey = null;
/* A recipe opened out of a library you had scrolled halfway down used to be
   drawn under the same offset, so it arrived at its own middle rather than at
   its title. Only an arrival scrolls: scaling the portions, ticking a mark or
   the body landing from the network all redraw the same recipe, and any of
   those throwing the page back to the top would be worse than the bug. Run
   after renderModal, because closing a dialog on the way in puts back the
   offset it was holding for the page underneath. */
function topOnNewRecipe() {
  let key = null;
  if (state.view === "detail") key = "d:" + String(state.activeId || "");
  else if (state.view === "link") {
    key = "l:" + String((state.linkRecipe && state.linkRecipe.recipeId) || "");
  }
  const arrived = key !== null && key !== shownRecipeKey;
  shownRecipeKey = key;
  if (arrived) scrollToY(0);
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

/* --- session ---
   Every field on the welcome screen is read back into state before anything
   redraws, because opening an info note or ticking the household box redraws
   the whole panel - and a form that loses what you typed the moment you ask
   it a question is not a form anybody finishes. */
function fieldValue(id) { const el = document.getElementById(id); return el ? el.value : null; }
function fieldChecked(id) { const el = document.getElementById(id); return el ? el.checked : null; }
function captureWelcome() {
  const pairs = [["w-name", "_wName"], ["w-email", "_wEmail"], ["w-email2", "_wEmail2"],
                 ["w-pass", "_wPass"], ["w-cookbook", "_wCookbook"],
                 ["w-lemail", "_wLoginEmail"], ["w-lpass", "_wLoginPass"]];
  pairs.forEach(function (p) {
    const v = fieldValue(p[0]);
    if (v !== null) state[p[1]] = v;
  });
  const join = fieldChecked("w-join");
  if (join !== null) state._wJoin = join;
  const save = fieldChecked("w-save");
  if (save !== null) state._wSave = save;
  const saveL = fieldChecked("w-lsave");
  if (saveL !== null) state._wSave = saveL;
}
Actions.wMode = function(which) {
  captureWelcome();
  state._wMode = state._wMode === which ? "" : which;
  state.modalError = "";
  renderApp();
};
Actions.wInfo = function(key) {
  captureWelcome();
  state._wInfo = state._wInfo || {};
  state._wInfo[key] = !state._wInfo[key];
  renderApp();
};
Actions.wToggleJoin = function() { captureWelcome(); renderApp(); };
function welcomeFailed(message) { state._wBusy = false; state.modalError = message; renderApp(); }
Actions.copyCookbookId = async function() {
  try { await navigator.clipboard.writeText(state.session.cookbookId); toast("Cookbook ID copied"); }
  catch (e) { toast("Couldn't copy — select the text instead"); }
};

Actions.signUp = async function() {
  captureWelcome();
  const name = (state._wName || "").trim();
  const email = (state._wEmail || "").trim();
  const email2 = (state._wEmail2 || "").trim();
  const pass = state._wPass || "";
  const join = !!state._wJoin;
  const cookbookId = (state._wCookbook || "").trim().toUpperCase();
  if (!name) { welcomeFailed("Enter the name your friends will see."); return; }
  if (!email) { welcomeFailed("Enter your email address."); return; }
  if (email.toLowerCase() !== email2.toLowerCase()) { welcomeFailed("The two email addresses do not match."); return; }
  if (pass.length < 8) { welcomeFailed("Pick a password of at least 8 characters."); return; }
  if (join && !cookbookId) { welcomeFailed("Paste the Cookbook ID you were given, or untick the household box."); return; }
  state._wBusy = true; state.modalError = ""; renderApp();
  let clientHash;
  try { clientHash = await derivePasswordKey(email, pass); }
  catch (e) { welcomeFailed("This browser cannot scramble the password. Try a current browser."); return; }
  try {
    const data = await API("auth/signup", {
      name: name, email: email, emailConfirm: email2, clientHash: clientHash,
      joinCookbook: join, cookbookId: join ? cookbookId : ""
    });
    await enterSession(data);
    if (data.claimed) toast("Welcome back — your cookbook is now on an email and password");
    else if (data.joined) toast("You joined a cookbook shared with " + (data.members - 1) + " other person");
    else toast("Account created — your cupboard is ready");
  } catch (e) { welcomeFailed(e.message); }
};

Actions.signIn = async function() {
  captureWelcome();
  const email = (state._wLoginEmail || "").trim();
  const pass = state._wLoginPass || "";
  if (!email) { welcomeFailed("Enter your email address."); return; }
  if (!pass) { welcomeFailed("Enter your password."); return; }
  state._wBusy = true; state.modalError = ""; renderApp();
  let clientHash;
  try { clientHash = await derivePasswordKey(email, pass); }
  catch (e) { welcomeFailed("This browser cannot scramble the password. Try a current browser."); return; }
  try {
    const data = await API("auth/login", { email: email, clientHash: clientHash });
    await enterSession(data);
  } catch (e) { welcomeFailed(e.message); }
};

async function enterSession(data) {
  state.session = {
    token: data.token, username: data.username, cookbookId: data.cookbookId,
    email: data.email || "", persist: !!state._wSave
  };
  saveSession(state.session);
  state._wBusy = false;
  state._wPass = ""; state._wLoginPass = "";
  state.modalError = "";
  state.view = "library";
  await refreshLibrary(true);
  /* They arrived by scanning something and have only now got a cookbook. */
  const waiting = takeStashedIntent();
  if (waiting) await Actions.beginIntent(waiting);
}

Actions.signOut = async function() {
  if (!confirm("Sign out on this device? You will need your email address and password to get back in.")) return;
  try { await API("auth/logout", {}); } catch (e) {}
  clearSession();
  state.session = null;
  state.modal = null;
  state.recipes = [];
  state.bodies = {};
  state.logs = {};
  state.ratings = {};
  state.cooks = {};
  state.cookFeed = [];
  state.bodyPending = {};
  state._wMode = "";
  state._wName = ""; state._wEmail = ""; state._wEmail2 = ""; state._wPass = "";
  state._wLoginEmail = ""; state._wLoginPass = "";
  state._wJoin = false; state._wCookbook = "";
  state._wInfo = {};
  state._wBusy = false;
  renderApp();
};

/* --- account --- */
Actions.copySupportEmail = async function() {
  try { await navigator.clipboard.writeText(SUPPORT_EMAIL); toast("Address copied"); }
  catch (e) { toast("Couldn't copy — select the text instead"); }
};
function acctFailed(message) { state._acctBusy = false; state.modalError = message; renderModal(); }
Actions.changePassword = async function() {
  const email = (state.session && state.session.email) || "";
  if (!email) { acctFailed("Sign out and back in first, so this device knows your address."); return; }
  const current = fieldValue("cp-current") || "";
  const next = fieldValue("cp-new") || "";
  const again = fieldValue("cp-new2") || "";
  if (!current) { acctFailed("Enter your current password."); return; }
  if (next.length < 8) { acctFailed("Pick a new password of at least 8 characters."); return; }
  if (next !== again) { acctFailed("The two new passwords do not match."); return; }
  state._acctBusy = true; state.modalError = ""; renderModal();
  try {
    const currentClientHash = await derivePasswordKey(email, current);
    const newClientHash = await derivePasswordKey(email, next);
    await API("account/password", { currentClientHash: currentClientHash, newClientHash: newClientHash });
    state._acctBusy = false;
    Actions.closeModal();
    toast("Password changed");
  } catch (e) { acctFailed(e.message); }
};
/* The address is half the salt the password is hashed with, so changing it
   means re-deriving against the new one. Both go up together: the old hash
   proves who is asking, the new one is what gets stored. */
Actions.changeEmail = async function() {
  const current = (fieldValue("ce-current") || "").trim();
  const next = (fieldValue("ce-new") || "").trim();
  const pass = fieldValue("ce-pass") || "";
  if (!current || !next) { acctFailed("Enter both addresses."); return; }
  if (current.toLowerCase() === next.toLowerCase()) { acctFailed("That is already your email address."); return; }
  if (!pass) { acctFailed("Enter your password."); return; }
  state._acctBusy = true; state.modalError = ""; renderModal();
  try {
    const clientHash = await derivePasswordKey(current, pass);
    const newClientHash = await derivePasswordKey(next, pass);
    const data = await API("account/email", {
      currentEmail: current, newEmail: next,
      clientHash: clientHash, newClientHash: newClientHash
    });
    state.session.email = data.email;
    saveSession(state.session);
    state._acctBusy = false;
    Actions.closeModal();
    toast("Email changed");
  } catch (e) { acctFailed(e.message); }
};
Actions.adminSetPassword = async function() {
  const token = (fieldValue("adm-token") || "").trim();
  const email = (fieldValue("adm-email") || "").trim();
  const temp = fieldValue("adm-temp") || "";
  const out = document.getElementById("adm-out");
  if (!token || !email || temp.length < 8) {
    if (out) out.textContent = "Needs the admin token, an address, and a password of at least 8 characters.";
    return;
  }
  if (out) out.textContent = "Working…";
  try {
    const clientHash = await derivePasswordKey(email, temp);
    const data = await API("admin/password", { token: token, email: email, clientHash: clientHash });
    if (out) out.textContent = "Temporary password set for " + data.username + ". They are signed out everywhere.";
  } catch (e) { if (out) out.textContent = "Failed: " + e.message; }
};

/* --- navigation --- */
Actions.openDetail = function(id, showLogs) {
  state.activeId = id; state.view = "detail"; state.scale = 1;
  state.customScaleOpen = false; state.customScale = ""; state._showAllLogs = !!showLogs;
  /* Reached from the box rather than from a calendar square, so the portions
     are the recipe's own again and the banner has nothing to say. */
  state.scheduledFor = null;
  setWatch(id);
  renderApp();
  /* The name, description and tags are already on screen from the card. The
     ingredients, the steps and the cook log are not, so they are fetched and
     dropped into place underneath rather than held up behind a blank page. */
  loadBodyInto(id);
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
/* The same page, opened on its other face. The bell in the header and the
   Notifications tile in the menu both land here rather than on Friends. */
Actions.openNotifications = function() {
  state.view = "friends";
  state.friendsTab = "notifications";
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
    state.notTags = [];
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
  const id = state.activeId;
  await refreshLibrary(false);
  setWatch(id);
  renderApp();
  /* A sync drops any body whose version moved, so this is what brings the
     new one back rather than leaving the reader on a loading line. */
  if (id && state.view === "detail") await loadBodyInto(id);
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
/* Filtering is local - nothing here asks the server anything - but rebuilding
   the results block still costs a pass over every recipe plus the markup for
   fifty cards, and doing that between two letters typed quickly is work
   thrown away. The state is set at once so the field and the clear button
   stay honest; only the redraw waits. */
const SEARCH_DELAY_MS = 140;
let searchTimer = null;
Actions.onSearchInput = function(v) {
  state.search = v;
  updateSearchClear();
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(function () { searchTimer = null; updateResultsSection(); }, SEARCH_DELAY_MS);
};
Actions.showMore = function() {
  state.shown = (state.shown || PAGE_SIZE) + PAGE_SIZE;
  updateResultsSection();
};
Actions.clearSearch = function() {
  if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
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
  state.notTags = [];
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
/* A tag is chosen, banned, or neither - never two of the three. Everything
   that draws or counts a tag asks this rather than reading the two lists. */
function tagPickState(l) {
  const k = String(l).toLowerCase();
  if (state.activeTags.some(x => String(x).toLowerCase() === k)) return "on";
  if ((state.notTags || []).some(x => String(x).toLowerCase() === k)) return "not";
  return "";
}
/* A tap. On a banned tag it lets it go rather than flipping it to chosen:
   one gesture undoes what the other did, so nothing needs two taps to clear. */
function toggleActiveTag(t) {
  const k = String(t).toLowerCase();
  if (tagPickState(t) === "not") {
    state.notTags = (state.notTags || []).filter(x => String(x).toLowerCase() !== k);
    return;
  }
  state.activeTags = state.activeTags.some(x => x.toLowerCase() === k)
    ? state.activeTags.filter(x => x.toLowerCase() !== k)
    : state.activeTags.concat([t]);
}
/* A long press. Chosen or neither both become banned; banned goes back to
   neither. A tag leaving activeTags on its way in is what keeps the two
   lists from ever both claiming it. */
function toggleNotTag(t) {
  const k = String(t).toLowerCase();
  const was = tagPickState(t) === "not";
  state.notTags = (state.notTags || []).filter(x => String(x).toLowerCase() !== k);
  if (was) return;
  state.activeTags = state.activeTags.filter(x => String(x).toLowerCase() !== k);
  state.notTags = state.notTags.concat([t]);
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
Actions.notFilterAt = function(i) {
  const t = (state._filterList || [])[i];
  if (!t) return;
  toggleNotTag(t);
  updateFilterBoxes();
  updateFilterCounts();
};
Actions.toggleTagAt = function(i) {
  const t = (state._tagList || [])[i];
  if (t === undefined) return;
  toggleActiveTag(t);
  updateLibraryChrome();
};
Actions.notTagAt = function(i) {
  const t = (state._tagList || [])[i];
  if (t === undefined) return;
  toggleNotTag(t);
  updateLibraryChrome();
};
/* The tags stay put across a change of shelf: the question being asked is
   usually "who else has one of these", so wiping them threw away the whole
   point of the switch. */
Actions.setOwnerFilter = function(v) {
  state.ownerFilter = v;
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
  withShareListScroll("share-form", renderApp);
};
/* Redrawing either surface rebuilds the three-row scroller from scratch,
   which throws it back to the top - so ticking somebody halfway down a long
   friend list used to lose your place in it. The offset is read before the
   redraw and put back after. Same idea as withMealSheetScroll, kept separate
   because one of these two lives in a sheet and the other in a full page. */
function withShareListScroll(idbase, fn) {
  const find = function () {
    return typeof document !== "undefined" && document.getElementById
      ? document.getElementById(idbase + "-list") : null;
  };
  const sheet = function () {
    return typeof document !== "undefined" && document.querySelector
      ? document.querySelector(".modal-box") : null;
  };
  const before = find(), boxBefore = sheet();
  const at = before ? (before.scrollTop || 0) : 0;
  const boxAt = boxBefore ? (boxBefore.scrollTop || 0) : 0;
  fn();
  const after = find(), boxAfter = sheet();
  if (after && at) after.scrollTop = at;
  if (boxAfter && boxAt) boxAfter.scrollTop = boxAt;
}
/* Typing replaces the field underneath the cursor, so the caret is put back
   where it was. The form has to be read out of the DOM first or a title typed
   before the search would be lost; the sheet has no form to lose. */
function shareSearch(v, idbase, redraw) {
  state.shareFriendSearch = v;
  withShareListScroll(idbase, redraw);
  const el = document.getElementById(idbase + "-search");
  if (el && el.focus) {
    el.focus();
    if (el.setSelectionRange) el.setSelectionRange(v.length, v.length);
  }
}
Actions.shareSearchForm = function(v) {
  syncDraftFromDOM();
  shareSearch(v, "share-form", renderApp);
};
Actions.shareSearchSheet = function(v) {
  shareSearch(v, "vis-share", renderModal);
};
/* Setting a mark is one tap and costs nothing. Taking one off can lose you a
   recipe you no longer have any other route back to - an unpinned recipe from
   a share link is gone from the box entirely - so the second tap asks. */
const UNMARK_WARNINGS = {
  pin: "Unpin this recipe? It comes out of your cookbook. Nothing of theirs is deleted, " +
    "but you will need their link or their friendship to find it again.",
  star: "Remove this from your favorites?",
  later: "Take this off Saved for later?"
};
Actions.toggleMark = async function(kind, id) {
  const on = !isMarked(kind, id);
  if (!on && !confirm(UNMARK_WARNINGS[kind] || "Remove this mark?")) return;
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
/* Tapping the chip opens a box rather than turning the chip into one. The
   number it already carries is put in the field and selected, so a second
   visit to 6x is a tap and a confirmation, and typing over it is one motion.
   Going through the box every time is deliberate: the chip is small enough
   that a stray tap would otherwise rescale the whole recipe silently. */
Actions.editCustomScale = function() {
  state._scaleDraft = state.customScale || "";
  state.modal = "customScale";
  renderModal();
  setTimeout(function () {
    const el = document.getElementById("scale-custom");
    if (!el) return;
    el.focus();
    if (el.setSelectionRange) { try { el.setSelectionRange(0, String(el.value).length); } catch (e) {} }
  }, 0);
};
/* A multiplier is a number. Anything else is dropped as it is typed rather
   than rejected afterwards, and only the first decimal point survives. */
Actions.scaleDigitsOnly = function(el) {
  if (!el) return;
  const clean = String(el.value).replace(/[^0-9.]/g, "").replace(/\\.(?=.*\\.)/g, "");
  if (clean !== el.value) el.value = clean;
  state._scaleDraft = clean;
};
/* Accept with nothing usable in the box closes it and leaves the recipe as it
   was. Refusing to close would be a scolding over a control nobody has to
   use. */
Actions.commitCustomScale = function(v) {
  const live = document.getElementById("scale-custom");
  const raw = v == null ? (live ? live.value : state._scaleDraft) : v;
  const clean = String(raw == null ? "" : raw).replace(/[^0-9.]/g, "").replace(/\\.(?=.*\\.)/g, "");
  const n = parseFloat(clean);
  if (!isNaN(n) && n > 0) {
    state.scale = n;
    state.customScale = trimNumber(n);
    state.customScaleOpen = true;
  }
  state._scaleDraft = "";
  Actions.closeModal();
  updateRecipeBody();
};
Actions.cancelCustomScale = function() {
  state._scaleDraft = "";
  Actions.closeModal();
};
Actions.toggleCustomScale = function() { Actions.editCustomScale(); };
Actions.setCustomScale = function(v) { Actions.commitCustomScale(v); };
Actions.toggleShowAllLogs = function() { state._showAllLogs = !state._showAllLogs; updateRecipeBody(); };

/* ---- Cook mode -------------------------------------------------------
   A screen wake lock, and nothing more: no bigger type, no hidden chrome.
   What it buys is a recipe that is still readable when you come back from
   the sink with your hands full.
   Two things about the platform shape this. The lock is only offered over
   https on iOS 16.4 and up, so on anything older there is no button at all
   rather than a button that lies. And iOS hands the lock back every time the
   page is hidden - a notification, a switch to the timer, the side button -
   so it has to be taken again each time the page comes back, which is what
   the visibilitychange handler below is for. Even then it only stops the
   automatic dim and lock; nothing can stop the side button, and nothing
   should. */
let wakeSentinel = null;
function wakeLockSupported() {
  return typeof navigator !== "undefined" && !!navigator.wakeLock &&
    typeof navigator.wakeLock.request === "function";
}
async function acquireWakeLock() {
  if (!wakeLockSupported() || wakeSentinel) return true;
  try {
    const s = await navigator.wakeLock.request("screen");
    wakeSentinel = s;
    /* The browser can drop it on its own - low battery, a policy change - and
       says so here. Forgetting the stale sentinel means the next attempt
       actually asks for a new one instead of assuming it still holds. */
    if (s && s.addEventListener) {
      s.addEventListener("release", function () { if (wakeSentinel === s) wakeSentinel = null; });
    }
    return true;
  } catch (e) { wakeSentinel = null; return false; }
}
function releaseWakeLock() {
  if (!wakeSentinel) return;
  try { wakeSentinel.release(); } catch (e) {}
  wakeSentinel = null;
}
Actions.toggleCookMode = async function () {
  if (state.cookMode) {
    state.cookMode = false;
    releaseWakeLock();
    renderApp();
    toast("Cook mode off");
    return;
  }
  /* Asked for on the tap rather than on the render, because the browsers
     that offer this require the request to come out of a real gesture. */
  const got = await acquireWakeLock();
  if (!got) { toast("This browser will not keep the screen awake."); return; }
  state.cookMode = true;
  renderApp();
  toast("Cook mode on - the screen will stay awake");
};
/* Walking away from the recipe ends it. Otherwise the screen burns on
   indefinitely with the only sign of it two views back. */
function endCookModeIfAway() {
  if (!state.cookMode) return;
  if (state.view === "detail" || state.view === "link") return;
  state.cookMode = false;
  releaseWakeLock();
}

Actions.openShare = function (recipeId) {
  state.shareId = recipeId;
  Actions.openModal("share");
};

Actions.openModal = function(name) {
  setTabsDown(false);
  /* A word left highlighted by the tap that got here would otherwise sit on
     whatever lands in the same place in the new sheet. */
  clearTextSelection();
  state.modal = name;
  state.modalError = "";
  state._acctBusy = false;
  /* A word left in the friend search from last time would hide most of the
     list the moment the sheet opened. */
  if (name === "visibility") state.shareFriendSearch = "";
  if (name === "import") { state.importParsed = []; state.importErrors = []; state.importFileName = null; state.importVisibility = ""; }
  if (name === "urlToRecipe") {
    state.urlToRecipe = { mode: state._nextImportMode || "", url: "", text: "", prompt: "", generated: false };
    state.importParsed = []; state.importErrors = []; state.importFileName = null; state.importVisibility = "";
  }
  /* Permission can be changed outside the app, so the switch is re-read
     every time the panel is opened rather than trusted from boot. */
  if (name === "account") {
    refreshPushState().then(function () {
      if (state.modal === "account") renderModal();
    }).catch(function () {});
  }
  renderModal();
};
Actions.closeModal = function() { state.modal = null; state.modalError = ""; renderModal(); updateLibraryChrome(); };

/* --- notifications on this device --- */
Actions.setPushKind = async function(kind, on) {
  try { await savePushKinds(kind, on === true); }
  catch (e) { toast((e && e.message) || "That did not save"); }
  renderModal();
};
Actions.togglePush = async function() {
  const p = state.push;
  if (p.busy) return;
  const turningOn = p.status !== "on";
  p.busy = true;
  renderModal();
  try {
    if (turningOn) await enablePush(); else await disablePush();
    if (p.status === "on") toast("Notifications on for this device");
    else if (p.status === "denied") toast("Your device is blocking notifications");
    else if (turningOn) toast("Notifications were not turned on");
    else toast("Notifications off for this device");
  } catch (e) {
    toast((e && e.message) || "That did not work");
    await refreshPushState().catch(function () {});
  }
  p.busy = false;
  renderModal();
};

/* --- rating --- */
/* One per cookbook, so this overwrites rather than adds, and 0 clears it.
   The library is re-read afterwards because the average on every card that
   shows this recipe has just moved. */
Actions.setRating = async function(n) {
  const r = getActiveRecipe();
  if (!r) return;
  const want = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  const st = statsFor(r.recipeId);
  if (!st.ourCooks) { toast("Log a cook first, then you can rate it"); return; }
  if (want === st.mine) return;
  try {
    await API("recipe/rate", { recipeId: r.recipeId, rating: want });
    await refreshLibrary(false);
    updateRecipeBody();
    toast(want ? "Rated " + want + " out of 5" : "Rating cleared");
  } catch (e) { toast(e.message); }
};

/* --- cook log --- */
Actions.saveCookLog = async function() {
  const r = getActiveRecipe();
  if (!r) return;
  const dateEl = document.getElementById("cl-date");
  const notesEl = document.getElementById("cl-notes");
  const date = (dateEl && dateEl.value) || todayStr();
  const comment = notesEl ? notesEl.value.trim() : "";
  try {
    await API("comment/add", { recipeId: r.recipeId, comment, cookedOn: date });
    state.modal = null;
    /* The log we hold for this recipe is now one entry short of the truth,
       so it is dropped and fetched again with the body still cached. */
    delete state.logs[r.recipeId];
    await refreshLibrary(false);
    await reloadLog(r.recipeId);
    setWatch(r.recipeId);
    toast("Cook logged");
  } catch (e) { state.modalError = e.message; renderModal(); }
};
Actions.deleteComment = async function(commentId) {
  if (!confirm("Delete this cook log entry?")) return;
  const id = state.activeId;
  try {
    await API("comment/delete", { commentId });
    delete state.logs[id];
    await refreshLibrary(false);
    await reloadLog(id);
    toast("Entry deleted");
  } catch (e) { toast(e.message); }
};
/* Re-reads one recipe's cook log without disturbing anything else. The body
   is already cached and unchanged, so only the log comes back into use. */
async function reloadLog(recipeId) {
  if (!recipeId) return;
  const keep = state.bodies[recipeId];
  delete state.bodies[recipeId];
  await ensureBody(recipeId);
  if (!state.bodies[recipeId] && keep) state.bodies[recipeId] = keep;
  renderApp();
}

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
  const warn = "Remove " + name + "?" +
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
Actions.exportAll = async function() {
  const list = hasActiveFilter() ? filteredRecipes() : state.recipes;
  if (!list.length) { toast("Nothing to export"); return; }
  /* A card carries a name and a line of description and nothing else, which
     is not a recipe. The bodies are fetched first, in batches, so what lands
     in the file is the whole thing. */
  state.busy = true;
  renderApp();
  await ensureBodies(list.map(r => r.recipeId));
  state.busy = false;
  renderApp();
  const bodies = list.map(r => recipeById(r.recipeId)).filter(hasBody);
  if (!bodies.length) { toast("Those recipes could not be read"); return; }
  const lines = bodies.map(r => JSON.stringify(normalizeBody(r)));
  const blob = new Blob([lines.join("\\n")], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (hasActiveFilter() ? "kindred-cupboard-selected-" : "kindred-cupboard-export-") + todayStr() + ".txt";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/* --- URL to recipe --- */
Actions.openImportPrompt = function(mode) {
  state._nextImportMode = mode || "";
  Actions.openModal("urlToRecipe");
  state._nextImportMode = null;
};
/* Each choice gets a clean sheet: the URL you typed for one source is not the
   text you meant to paste into another. */
Actions.pickImportMode = function(mode) {
  state.urlToRecipe = { mode: mode, url: "", text: "", prompt: "", generated: false };
  if (mode === "json") {
    state.importParsed = []; state.importErrors = []; state.importFileName = null; state.importVisibility = "";
  }
  state.modalError = "";
  renderModal();
};
Actions.backToImportMenu = function() {
  state.urlToRecipe = { mode: "", url: "", text: "", prompt: "", generated: false };
  state.modalError = "";
  renderModal();
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
  /* A fresh form starts with the whole friend list showing. */
  state.shareFriendSearch = "";
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
/* Two ways to start a recipe, asked before the form rather than from a
   button tucked into its corner. Importing rewrites the draft the moment it
   lands, so offering both at once meant a half-typed recipe could be thrown
   away by a button sitting next to Save. */
Actions.openNew = function() { Actions.openModal("newRecipe"); };
Actions.startBlankRecipe = function() {
  state.modal = null;
  state.editDraft = blankDraft();
  /* A fresh form starts with the whole friend list showing. */
  state.shareFriendSearch = "";
  state.editIsNew = true;
  state.editingId = null;
  state.editBaseUpdatedAt = null;
  state.editForce = false;
  setWatch(null);
  state.view = "edit";
  renderApp();
};
Actions.openEdit = async function(id, takeover) {
  const sum = summaryById(id);
  if (!sum || !sum.ours) { toast("You can only edit recipes in your own cookbook"); return; }
  /* The form is the whole recipe, so unlike the reading view there is nothing
     useful to show before it has arrived. */
  await ensureBody(id);
  const r = recipeById(id);
  if (!hasBody(r)) { toast("That recipe could not be opened for editing"); return; }

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
  /* A fresh form starts with the whole friend list showing. */
  state.shareFriendSearch = "";
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
/* Typing in the last row conjures the next one. The row is appended to the
   container rather than re-rendered into it, because a re-render would take
   the caret out of the field being typed in. */
function appendDraftRow(boxId, rowHTML, prevDownId) {
  const box = document.getElementById(boxId);
  if (!box || typeof box.insertAdjacentHTML !== "function") { renderApp(); return; }
  box.insertAdjacentHTML("beforeend", rowHTML);
  const prev = document.getElementById(prevDownId);
  if (prev) prev.disabled = false;
}
Actions.growIngredients = function() {
  const d = state.editDraft;
  if (!d) return;
  syncDraftFromDOM();
  const n = d.ingredients.length;
  if (!n || ingredientIsBlank(d.ingredients[n - 1])) return;
  d.ingredients.push(blankIngredient());
  appendDraftRow("ingredients-container",
    IngredientRowHTML(d.ingredients[n], n, n + 1), "ing-down-" + (n - 1));
};
Actions.growSteps = function() {
  const d = state.editDraft;
  if (!d) return;
  syncDraftFromDOM();
  const n = d.steps.length;
  if (!n || stepIsBlank(d.steps[n - 1])) return;
  d.steps.push(blankStep());
  appendDraftRow("steps-container", StepRowHTML(d.steps[n], n, n + 1), "step-down-" + (n - 1));
};
Actions.addIngredient = function() {
  syncDraftFromDOM();
  state.editDraft.ingredients.push(blankIngredient());
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
  state.editDraft.steps.push(blankStep());
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
  /* The spare row on the end of each list is scaffolding, not content. */
  stripBlankRows(d);
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
    /* The library carries no bodies, and the sync just dropped the cached one
       - the save moved the recipe's stamp, which is exactly what tells the
       cache it is looking at a version that no longer exists. Without this
       the recipe you just saved lands on its own page saying it is loading
       and never finishes, because nothing else was ever going to ask for it.
       Fetched rather than kept from the form, so the cook log comes back with
       it and the cached stamp is the server's own. */
    await loadBodyInto(res.recipeId);
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
  withShareListScroll("vis-share", renderModal);
  try {
    await API("recipe/share", { recipeId: r.recipeId, usernames: list });
    await refreshLibrary(false);
  } catch (e) { toast(e.message); }
};
/* Leaving a shared recipe. With an account that means the cupboard; with
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
    /* A brand new recipe id, so there is nothing cached under it. Same hole
       as saving an edit: without this the copy sits on its own page saying it
       is loading and nothing ever asks for the rest of it. */
    await loadBodyInto(res.recipeId);
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
  if (!summaryById(e.recipeId)) { toast("That recipe is no longer in your box"); return; }
  state.modal = null;
  state.calDay = null;
  state.activeId = e.recipeId;
  state.view = "detail";
  state.scale = factorFor(recipeById(e.recipeId), e.servings);
  syncCustomScale();
  state.scheduledFor = { entryId: e.entryId, recipeId: e.recipeId, date: e.date, servings: e.servings };
  state._showAllLogs = false;
  setWatch(e.recipeId);
  renderApp();
  /* The scale depends on the recipe's own base servings, which live in the
     body, so it is worked out again once that has landed. */
  loadBodyInto(e.recipeId, function () {
    state.scale = factorFor(recipeById(e.recipeId), e.servings);
    syncCustomScale();
  });
};

/* Same rule as the library search: repaint the results only, or the field
   loses focus and the word is lost halfway through typing it. */
/* Results render below the fold on a phone, so tapping the field brings the
   search block up to the top of the dialog. Aligning the block rather than
   scrolling to the very bottom means the results stay in view as they grow,
   instead of pushing themselves back off the end. Repeated because iOS
   raises the keyboard and re-lays out the viewport after the focus event,
   which undoes a single scroll set before it.
   Skipped entirely while the block is already sitting in clear view. Hauling
   a dialog you were reading up to the top the moment you touch its search
   field is movement for its own sake; the repeats mean the pin still happens
   the moment the keyboard rises far enough to cover it. */
function pinBlockIntoView(blockId) {
  const pin = function () {
    const box = document.querySelector(".modal-box");
    const blk = document.getElementById(blockId);
    if (!box || !blk || !box.getBoundingClientRect) return;
    if (fieldInView(blk, visibleBand())) return;
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
Actions.toggleSchedIng = function() {
  state.schedIngOpen = !state.schedIngOpen;
  renderModal();
};
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

Actions.openSchedule = async function(recipeId, onDate, backToDay) {
  if (!summaryById(recipeId)) { toast("That recipe is no longer in your box"); return; }
  /* The frame prices the ingredients for a number of mouths, so it needs the
     ingredients and the recipe's own base servings before it can open. */
  await ensureBody(recipeId);
  const r = recipeById(recipeId);
  if (!r) { toast("That recipe is no longer in your box"); return; }
  state.scheduleDraft = {
    entryId: null,
    recipeId: recipeId,
    date: onDate || state.calDay || localToday(),
    servings: ((r.servings && Number(r.servings.base) > 0) ? Number(r.servings.base) : 1),
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
Actions.openScheduleEdit = async function(entryId) {
  const e = entryById(entryId);
  if (!e) return;
  if (!summaryById(e.recipeId)) { toast("That recipe is no longer in your box"); return; }
  await ensureBody(e.recipeId);
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
        syncCustomScale();
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
  withMealSheetScroll(renderModal);
  const el = document.getElementById("meal-friend-search");
  if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
};
/* Redrawing the sheet resets every scroller in it, so ticking a friend
   halfway down a long list used to throw both the list and the sheet back to
   the top. Both offsets are read before the redraw and put back after it. */
function withMealSheetScroll(fn) {
  const read = function (sel) {
    const el = typeof document !== "undefined" && document.querySelector
      ? document.querySelector(sel) : null;
    return el ? (el.scrollTop || 0) : 0;
  };
  const listAt = read("#meal-friend-list");
  const sheetAt = read(".modal-box");
  fn();
  const put = function (sel, y) {
    const el = typeof document !== "undefined" && document.querySelector
      ? document.querySelector(sel) : null;
    if (el && y) el.scrollTop = y;
  };
  put("#meal-friend-list", listAt);
  put(".modal-box", sheetAt);
}
Actions.toggleMealGuest = function(username) {
  const dr = state.mealDraft;
  if (!dr) return;
  /* The form is re-read before the list is redrawn, or typing a title and
     then picking a guest would lose the title. */
  readMealDraftFields();
  const at = dr.guests.map(u => u.toLowerCase()).indexOf(String(username).toLowerCase());
  if (at >= 0) dr.guests.splice(at, 1); else dr.guests.push(username);
  withMealSheetScroll(renderModal);
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
  /* A meal you cannot go to is not a meal. The date input carries a min as
     well, but a typed date gets past that on some keyboards. */
  if (dr.date < localToday()) {
    state.modalError = "That day has already been. Pick today or later.";
    renderModal();
    return;
  }
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
Actions.openMealAdd = async function(recipeId) {
  const meals = mealsIcanBringTo();
  if (!meals.length) { toast("No upcoming meal to add it to"); return; }
  const sum = summaryById(recipeId);
  if (!sum) { toast("That recipe is no longer there"); return; }
  await ensureBody(recipeId);
  const r = recipeById(recipeId) || sum;
  state.mealAdd = {
    recipeId: recipeId, title: r.title, mealId: meals[0].mealId,
    servings: (r.servings && Number(r.servings.base)) || 1,
    unit: (r.servings && r.servings.unit) || "servings"
  };
  Actions.openModal("mealAdd");
};
Actions.setMealAddMeal = function(mealId) {
  if (!state.mealAdd) return;
  const f = document.getElementById("meal-add-serv");
  if (f) state.mealAdd.servings = f.value;
  state.mealAdd.mealId = mealId;
  renderModal();
};
Actions.confirmMealAdd = async function() {
  const d = state.mealAdd;
  if (!d || state.busy) return;
  const f = document.getElementById("meal-add-serv");
  const servings = Number(f ? f.value : d.servings);
  if (!(servings > 0)) { toast("How many are you making?"); return; }
  const m = mealById(d.mealId);
  if (!m) { toast("That meal is no longer there"); return; }
  const clash = m.dishes.filter(function (x) {
    return String(x.title).trim().toLowerCase() === String(d.title).trim().toLowerCase();
  }).length;
  if (clash && !confirm("Somebody is already bringing " + d.title +
    ". Add it anyway? The tile will read \\"Lots of " + d.title + "\\".")) return;
  try {
    await API("meal/dish/add", { mealId: d.mealId, recipeId: d.recipeId, servings: servings });
    state.mealAdd = null;
    Actions.closeModal();
    await refreshLibrary(false);
    toast("On the table, and on your calendar");
  } catch (err) { toast(err.message); }
};
Actions.cancelMeal = async function(mealId) {
  const m = mealById(mealId);
  if (!m) return;
  const gone = isMealPast(m);
  const warn = gone
    ? "Delete " + m.title + " for everyone? It comes off every guest's calendar as well as " +
      "yours. This cannot be undone."
    : "Cancel " + m.title + " for everyone? Every guest's dishes come off their " +
      "calendars as well as yours. This cannot be undone.";
  if (!confirm(warn)) return;
  try {
    await API("meal/cancel", { mealId });
    await refreshLibrary(false);
    toast(gone ? "Meal deleted" : "Meal cancelled");
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
/* The strip of window that is actually looking at the page: above the
   keyboard when one is up, the whole thing when it is not. Read from the
   visual viewport, because the layout viewport does not shrink for a
   keyboard - which is why scrollIntoView cannot be used for this. */
function visibleBand() {
  const vv = (typeof window !== "undefined") ? window.visualViewport : null;
  if (vv && vv.height) return { top: vv.offsetTop || 0, height: vv.height };
  const h = (typeof window !== "undefined" && window.innerHeight) ||
    (typeof document !== "undefined" && document.documentElement && document.documentElement.clientHeight) || 0;
  return { top: 0, height: h };
}
/* Everything between the field and the page that can scroll, innermost
   first. A field inside a modal's own scrolling body has to move that box;
   moving the page underneath would not shift it at all. */
function scrollParents(el) {
  const out = [];
  let n = el && el.parentNode;
  while (n && n.nodeType === 1) {
    if (n.scrollHeight > n.clientHeight + 1) {
      let ov = "";
      try {
        const st = (typeof window !== "undefined" && window.getComputedStyle) ? window.getComputedStyle(n) : null;
        ov = st ? (st.overflowY || st.overflow || "") : "";
      } catch (e) { ov = ""; }
      if (!ov || ov === "auto" || ov === "scroll" || ov === "overlay") out.push(n);
    }
    n = n.parentNode;
  }
  return out;
}
/* How much clear space a field needs above and below it before it counts as
   properly on screen. Without a little slack a field flush against the
   keyboard line counts as visible and then gets covered by the next pixel of
   keyboard. */
const IN_VIEW_MARGIN = 8;
/* Whether the field can already be seen and typed into. A field taller than
   the room left can never sit inside the band, so that one is judged on its
   first line: if you can see where the cursor is, nothing needs to move. */
function fieldInView(el, band) {
  if (!el || !el.getBoundingClientRect || !band.height) return false;
  const r = el.getBoundingClientRect();
  const top = band.top + IN_VIEW_MARGIN;
  const bottom = band.top + band.height - IN_VIEW_MARGIN;
  if (r.height > band.height - (IN_VIEW_MARGIN * 2)) {
    return r.top >= band.top - IN_VIEW_MARGIN && r.top <= bottom;
  }
  return r.top >= top && r.bottom <= bottom;
}
/* Tapping a field halfway down a long page puts the keyboard over the thing
   you just tapped, and the browser's own scroll correction fires before the
   keyboard has finished coming up, so the field lands wherever the page
   happened to be. This puts it in the middle of whatever room is left.
   Only when it has to. A field you can already see is left exactly where it
   is: recentring one that was fine where it was moves the whole page out
   from under you, and adding twenty tags one at a time meant twenty of
   those. The check runs again on the second pass, so a field the keyboard
   goes on to cover is still rescued.
   Done by hand rather than with scrollIntoView, which centres in the layout
   viewport and so aims at a point underneath the keys. Each pass measures
   again and hands what is left to the next box out, so a field inside a
   scrolling modal still lands right when that box runs out of travel.
   No smoothing: the follow-up pass measures a live rect the moment the
   keyboard has finished rising, and an animation in flight would be
   measuring the wrong place. */
function bringIntoView(el) {
  if (!el) return;
  if (!el.getBoundingClientRect) { if (el.scrollIntoView) el.scrollIntoView(); return; }
  const band = visibleBand();
  if (!band.height) { if (el.scrollIntoView) el.scrollIntoView(); return; }
  if (fieldInView(el, band)) return;
  const boxes = scrollParents(el);
  for (let i = 0; i <= boxes.length; i++) {
    const r = el.getBoundingClientRect();
    /* A field taller than the room left is aimed by its top instead - there
       is no middle to put it in, and hiding its first line is the worse
       half to lose. */
    const room = band.height - r.height;
    const want = band.top + (room > 0 ? room / 2 : 0);
    const delta = Math.round(r.top - want);
    if (delta > -2 && delta < 2) return;
    if (i < boxes.length) boxes[i].scrollTop += delta;
    else scrollToY(scrollAt() + delta);
  }
}
/* The second pass catches the resize when the keyboard opens, which is what
   actually shifts the field out from under the cursor. It is cancelled the
   moment a key is pressed, so nothing moves once you are typing. */
let pendingFocusScroll = 0;
function cancelFocusScroll() {
  if (!pendingFocusScroll) return;
  clearTimeout(pendingFocusScroll);
  pendingFocusScroll = 0;
}
function focusIntoView(el) {
  if (!el) return;
  bringIntoView(el);
  cancelFocusScroll();
  pendingFocusScroll = setTimeout(function () {
    pendingFocusScroll = 0;
    if (typeof document !== "undefined" && document.activeElement === el) bringIntoView(el);
  }, 320);
}
Actions.focusMealSearch = function(id) {
  focusIntoView(document.getElementById(id));
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
    focusIntoView(el);
  }, 0);
}
/* The recipe summary a sync brings back does not carry servings - the body
   is fetched only when a recipe is opened - so a recipe nobody has opened
   this session had no servings.base to read, and picking it threw before it
   could do anything. That is why only the one recipe whose body happened to
   be cached could be chosen. The body is fetched first now, and the unit
   travels on the pick so the row can label itself without it. */
Actions.pickMealDish = async function(mealId, recipeId) {
  const sum = summaryById(recipeId);
  if (!sum) { toast("That recipe is no longer there"); return; }
  await ensureBody(recipeId);
  const r = recipeById(recipeId) || sum;
  const sv = (r.servings && Number(r.servings.base)) || 1;
  const unit = (r.servings && r.servings.unit) || "servings";
  const pick = { recipeId: recipeId, title: r.title, servings: sv, unit: unit };
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
  state.busy = true;
  renderApp();
  await ensureBodies(scheduledRecipeIds(rng.start, rng.end));
  const items = buildGroceryItems(rng.start, rng.end);
  if (!items.length && !confirm("Nothing is scheduled for those days. Build an empty list anyway?")) {
    state.busy = false;
    renderApp();
    return;
  }
  const label = uniqueListLabel(rangeLabel(rng.start, rng.end), state.groceryLists);
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
/* Guarded on every step: this runs in a stripped-down window under test,
   and a browser that will not tell us about its selection is not a reason
   to stop opening the sheet. */
function clearTextSelection() {
  try {
    const sel = typeof window !== "undefined" && window.getSelection ? window.getSelection() : null;
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
  } catch (e) {}
}
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
    if (document.hidden) return;
    pollWatched();
    /* iOS gives the wake lock back the moment the page is hidden, so coming
       back to a recipe with cook mode still on means asking for it again. */
    if (state.cookMode) acquireWakeLock();
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
/* Every text field in the app, not only the ones that asked. Bound once on
   the document because the views are emptied and refilled on every render,
   so per-field handlers would need rewiring each time - and because the rule
   is the same everywhere: the thing you are typing into comes to the top of
   whatever the keyboard has left, and then stays there. The first keystroke
   cancels the follow-up pass, so nothing moves under you mid-word. */
if (typeof document !== "undefined" && document.addEventListener) {
  const TYPEABLE = { INPUT: 1, TEXTAREA: 1 };
  const NO_SCROLL_TYPES = { checkbox: 1, radio: 1, file: 1, button: 1, submit: 1, hidden: 1, range: 1 };
  document.addEventListener("focusin", function (e) {
    const el = e && e.target;
    if (!el || !TYPEABLE[el.tagName]) return;
    if (el.tagName === "INPUT" && NO_SCROLL_TYPES[String(el.type || "text").toLowerCase()]) return;
    focusIntoView(el);
  });
  document.addEventListener("input", cancelFocusScroll);
  document.addEventListener("focusout", cancelFocusScroll);
}
/* Long press is the second gesture on a tag: a tap chooses it, a press bans
   it. Bound once on the document and read from a data attribute, because
   the chips are rebuilt on every keystroke and per-element handlers would
   have to be rewired each time. With no pointer to hold down, a right-click
   says the same thing. */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;
function longPressKey(el) {
  let n = el;
  while (n && n.nodeType === 1) {
    const v = n.getAttribute ? n.getAttribute("data-lp") : null;
    if (v) return v;
    n = n.parentNode;
  }
  return null;
}
function runLongPress(key) {
  const at = String(key).indexOf(":");
  if (at < 0) return;
  const kind = key.slice(0, at), i = Number(key.slice(at + 1));
  if (kind === "tag") Actions.notTagAt(i);
  else if (kind === "filter") Actions.notFilterAt(i);
}
if (typeof document !== "undefined" && document.addEventListener) {
  let lpTimer = 0, lpFired = false, lpTouchAt = 0, lpX = 0, lpY = 0;
  const lpStop = function () { if (lpTimer) clearTimeout(lpTimer); lpTimer = 0; };
  const touchPoint = function (e) {
    return (e && e.touches && e.touches[0]) ? e.touches[0] : (e && e.changedTouches && e.changedTouches[0]) || e || {};
  };
  document.addEventListener("touchstart", function (e) {
    lpTouchAt = Date.now();
    lpFired = false;
    lpStop();
    if (e && e.touches && e.touches.length > 1) return;
    const key = longPressKey(e && e.target);
    if (!key) return;
    const p = touchPoint(e);
    lpX = p.clientX || 0; lpY = p.clientY || 0;
    lpTimer = setTimeout(function () {
      lpTimer = 0;
      lpFired = true;
      runLongPress(key);
    }, LONG_PRESS_MS);
  }, { passive: true });
  /* A press that turns into a scroll is a scroll. */
  document.addEventListener("touchmove", function (e) {
    if (!lpTimer) return;
    const p = touchPoint(e);
    if (Math.abs((p.clientX || 0) - lpX) > LONG_PRESS_SLOP ||
        Math.abs((p.clientY || 0) - lpY) > LONG_PRESS_SLOP) lpStop();
  }, { passive: true });
  document.addEventListener("touchend", lpStop);
  document.addEventListener("touchcancel", lpStop);
  document.addEventListener("contextmenu", function (e) {
    const key = longPressKey(e && e.target);
    if (!key) return;
    if (e.preventDefault) e.preventDefault();
    lpStop();
    /* Android raises this from the same press the timer has already acted
       on, so anything within reach of a finger is left to the timer. */
    if (lpFired || (Date.now() - lpTouchAt) < 1500) return;
    runLongPress(key);
  });
  /* Capture, so the tap that ends a long press is swallowed before it
     reaches the chip's own handler and undoes what the press just did. */
  document.addEventListener("click", function (e) {
    if (!lpFired) return;
    lpFired = false;
    if (!longPressKey(e && e.target)) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }, true);
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
    if (scanned && scanned.type !== "push") { stashIntent(scanned); state._arrivedByScan = true; }
    renderApp();
    return;
  }
  await refreshLibrary(true);
  /* A code scanned just now wins over one left over from an abandoned visit. */
  const intent = scanned || takeStashedIntent();
  if (intent && intent.type === "push") await openPushTarget(intent.target);
  else if (intent) await Actions.beginIntent(intent);
  /* Last, and never in the way: works out whether this device is signed up
     for notifications so Settings can say so, and quietly re-registers the
     worker on every start in case it was thrown away. */
  refreshPushState().catch(function () {});
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

/* Display names: 2-25 characters. Must open with a letter or digit and must
   not end on a space, so a name can carry an internal space ("Aunt Ruth")
   without picking up invisible padding at either end. Runs of whitespace are
   collapsed to one plain space by normalizeUsername before this is tested,
   which is also what keeps tabs and newlines out. */
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,23}[A-Za-z0-9_.-]$/;
const USERNAME_RULE = "Names are 2-25 characters: letters, numbers, spaces, dot, dash or underscore.";
function normalizeUsername(v) {
  return cleanString(v, 40).replace(/\s+/g, " ").trim();
}
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
/* D1 caps a statement at 100 bound parameters. The reach queries dodge that
   by asking the friendships table directly, but the places that genuinely
   hold a list of ids - the households to be named, the meals to be filled in
   - have no subquery to hide behind. A cookbook with fifty friends, or one
   on a lot of guest lists, would sail past the cap and the statement would
   throw rather than slow. So the list is cut into lengths the cap allows and
   the pieces go out together in one batch, which costs the same round trip a
   single statement would have. */
const IN_CHUNK = 90;
function chunked(list) {
  const out = [];
  for (let i = 0; i < list.length; i += IN_CHUNK) out.push(list.slice(i, i + IN_CHUNK));
  return out;
}
/* One batch, all rows, order irrelevant. */
async function batchRows(env, statements) {
  if (!statements.length) return [];
  const res = await env.DB.batch(statements);
  const out = [];
  for (const r of res) for (const row of ((r && r.results) || [])) out.push(row);
  return out;
}

function cleanString(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max || 500) : "";
}

/* ---------------------------------------------------------------- auth --
   Passwords are hashed twice, in two different places, for one reason: a
   Worker on the free plan gets ten milliseconds of CPU per request, and a
   password hash worth the name costs more than that. So the expensive half
   runs in the browser - PBKDF2-HMAC-SHA256, 100,000 rounds, salted with the
   address so no round trip is needed to look the salt up - and the server
   only ever sees the result. What arrives here is therefore a password
   equivalent, not a password: it must not be stored as it stands, or the
   database would hold the very thing an attacker needs to sign in. Hence the
   cheap second pass with a per-account random salt, which is one SHA-256 and
   costs nothing. The plaintext never leaves the device, and none of this
   changes if the Worker moves to Paid. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CLIENT_HASH_RE = /^[0-9a-f]{64}$/;
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SESSION_DAYS = 90;
/* A cookbook is a household, and a household is two people. Anyone else you
   cook with is a friend, which shares recipes without handing over the keys
   to the whole cupboard. */
const MAX_COOKBOOK_MEMBERS = 2;
const BAD_COOKBOOK_TRIES = 5;

function hexOf(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}
async function sha256Hex(text) {
  return hexOf(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
/* The cheap second pass. Salted per account so two people who chose the same
   password do not land on the same row value. */
function serverHash(salt, clientHash) { return sha256Hex(String(salt) + ":" + String(clientHash)); }
/* Comparison that does not return early on the first wrong character. */
function sameSecret(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
const newSessionToken = () => randomFrom(TOKEN_ALPHABET, 43);
function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
}
async function startSession(env, usernameLc) {
  const token = newSessionToken();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (token, username_lc, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(token, usernameLc, now, sessionExpiry()).run();
  return token;
}
async function setPassword(env, usernameLc, clientHash) {
  const salt = randomFrom(TOKEN_ALPHABET, 24);
  const stored = await serverHash(salt, clientHash);
  await env.DB.prepare(
    "UPDATE users SET pw_hash = ?, pw_salt = ?, pw_updated_at = ? WHERE username_lc = ?"
  ).bind(stored, salt, new Date().toISOString(), usernameLc).run();
}
/* Changing a password or an address logs every other device out. The one
   asking keeps its own token, so the person doing it is not thrown out of
   the screen they are standing on. */
async function dropOtherSessions(env, usernameLc, keepToken) {
  await env.DB.prepare(
    "DELETE FROM sessions WHERE username_lc = ? AND token != ?"
  ).bind(usernameLc, keepToken || "").run();
}
async function emailRowFor(env, usernameLc) {
  return await env.DB.prepare(
    "SELECT email, email_lc FROM user_emails WHERE username_lc = ?"
  ).bind(usernameLc).first();
}

async function requireAuth(env, body) {
  const token = cleanString(body.token, 80);
  if (!token) throw new ApiError(401, "Sign in again to continue.", "AUTH");
  const row = await env.DB.prepare(
    "SELECT s.expires_at AS expires_at, u.username AS username, u.username_lc AS username_lc, " +
    "u.cookbook_id AS cookbook_id FROM sessions s JOIN users u ON u.username_lc = s.username_lc " +
    "WHERE s.token = ?"
  ).bind(token).first();
  if (!row) throw new ApiError(401, "Sign in again to continue.", "AUTH");
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    throw new ApiError(401, "That sign-in has expired. Sign in again to continue.", "AUTH");
  }
  return {
    username: row.username, usernameLc: row.username_lc,
    cookbookId: row.cookbook_id, token: token
  };
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
/* The same counter, read against a limit of the caller's choosing. Five
   wrong Cookbook IDs is a different thing from thirty failed lookups, and
   guessing a ten-character ID is exactly what the low number is for. */
async function attemptGuard(env, bucket, max, what) {
  const row = await env.DB.prepare(
    "SELECT window_start, count FROM rate_limits WHERE bucket = ?"
  ).bind(bucket).first();
  if (row && (Date.now() - row.window_start) < RL_WINDOW_MS && row.count >= max) {
    const mins = Math.max(1, Math.ceil((RL_WINDOW_MS - (Date.now() - row.window_start)) / 60000));
    throw new ApiError(429, "Too many " + what + ". Try again in " + mins +
      " minute" + (mins === 1 ? "" : "s") + ".");
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
  const rows = await batchRows(env, chunked(ids).map(part => env.DB.prepare(
    "SELECT username, cookbook_id FROM users WHERE cookbook_id IN (" +
    placeholders(part.length) + ") ORDER BY username COLLATE NOCASE"
  ).bind(...part)));
  for (const r of rows) {
    (map[r.cookbook_id] = map[r.cookbook_id] || []).push(r.username);
  }
  /* Sorting is per cookbook anyway, and comes back per chunk, so it is
     settled here rather than trusted to the statement. */
  for (const cb of Object.keys(map)) {
    map[cb].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
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

/* Everything one cookbook is allowed to see, as a fragment of SQL. Written
   once and used by the library listing, the rating totals, the cook totals
   and the batch body fetch, so those four can never drift apart on what
   counts as visible. prefix is "r." where the recipes table is joined under
   an alias and "" where it is the only table in the statement. */
/* The cookbooks linked to this one, as a subquery rather than a list of
   bound ids. D1 caps a statement at 100 bound parameters. Inlining one
   placeholder per friend - twice over in the heaviest queries, once for
   which recipes are reachable and once for whose ratings and cooks count -
   put a hard ceiling of 48 friends on a sync, past which it threw rather
   than slowed. Asking the friendships table directly costs two binds no
   matter how many friends there are, and saves a round trip besides.

   The union of the two halves is deliberate. There is an index on each of
   requester_cb and addressee_cb, and this form uses both; an OR across the
   two columns tends to collapse into a scan instead. */
const FRIEND_CBS_SQL =
  "SELECT addressee_cb AS cb FROM friendships WHERE requester_cb = ? AND status = 'accepted' " +
  "UNION SELECT requester_cb AS cb FROM friendships WHERE addressee_cb = ? AND status = 'accepted'";

/* The same set plus this cookbook itself: whose ratings and whose cook log
   entries this cookbook is allowed to see. Three binds, always. */
function voicesClause(cookbookId) {
  return { sql: "SELECT ? AS cb UNION " + FRIEND_CBS_SQL,
           binds: [cookbookId, cookbookId, cookbookId] };
}

/* A short fingerprint of who this cookbook is linked to, and when each link
   was last touched. It changes when a friendship is made, unmade or remade,
   and not otherwise - so the client can tell a sync where its reach moved
   from an ordinary one where only recipes did.

   This matters because a reach change alters things the per-recipe version
   check cannot see. A friend's recipe keeps the same updated_at when you
   befriend somebody new, but its cook log does not: the log is filtered by
   who you are linked to, so a cached copy is quietly missing the new
   household's entries, or still showing an old one's. */
function reachStamp(pairs) {
  const flat = pairs.slice().sort().join("|");
  let h = 2166136261;
  for (let i = 0; i < flat.length; i++) {
    h ^= flat.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return pairs.length + "-" + (h >>> 0).toString(36);
}

function visibleRecipeClause(cookbookId, prefix) {
  const p = prefix || "";
  const binds = [cookbookId];
  let clause = p + "cookbook_id = ?";
  clause += " OR (" + p + "visibility = 'friends' AND " + p + "cookbook_id IN (" +
    FRIEND_CBS_SQL + "))";
  binds.push(cookbookId, cookbookId);
  /* A recipe handed to this cookbook specifically - which is what the
     selective tier is - or one they pinned from a share link. */
  clause += " OR " + p + "recipe_id IN (SELECT recipe_id FROM recipe_shares WHERE cookbook_id = ?)";
  binds.push(cookbookId);
  clause += " OR " + p + "recipe_id IN (SELECT recipe_id FROM link_grants WHERE cookbook_id = ?)";
  binds.push(cookbookId);
  return { clause, binds };
}

/* How much cooking news rides along with a sync, and for how long. Both are
   deliberately small: this is the notifications page catching up, not an
   archive, and the full log of any recipe is one tap away inside it. */
const COOK_FEED_DAYS = 60;
const COOK_FEED_MAX = 60;
/* A shopping list or an export can want a lot of recipes at once. This is the
   ceiling on one request; the client sends more than one batch above it. */
const MAX_BODY_BATCH = 40;

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

/* The parts of a recipe the box tab needs in order to draw a card and answer
   a search, lifted out of the blob and kept in columns of their own. The
   ingredient names are one flat lowercase string rather than a list because
   nothing does anything with them except look for a substring: the search
   box used to match on ingredients only because the whole recipe was in
   memory, and this is what keeps that working once it is not. */
const MAX_SUMMARY_DESC = 2000;
const MAX_ING_NAMES = 2000;
function summaryOf(data) {
  const d = data || {};
  const tags = Array.isArray(d.tags)
    ? d.tags.filter(Boolean).map(t => String(t).trim()).filter(Boolean).slice(0, 60)
    : [];
  const names = Array.isArray(d.ingredients)
    ? d.ingredients.map(i => String((i && i.name) || "").trim()).filter(Boolean)
    : [];
  return {
    description: String(d.description || "").slice(0, MAX_SUMMARY_DESC),
    tags: JSON.stringify(tags),
    ingNames: names.join(" ").toLowerCase().slice(0, MAX_ING_NAMES)
  };
}
function validateRecipeData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(400, "The recipe was not readable.");
  const title = cleanString(data.title, 200);
  if (!title) throw new ApiError(400, "The recipe needs a title.");
  const text = JSON.stringify(data);
  if (text.length > MAX_RECIPE_BYTES) throw new ApiError(413, "That recipe is too big to store.");
  const s = summaryOf(data);
  return { title, text, description: s.description, tags: s.tags, ingNames: s.ingNames };
}

/* ================================================================ API === */
/* Marks and private shares arrived after the original schema, so the tables
   are created on demand rather than by hand in the D1 console. Cheap: one
   pass per isolate. */
const LATER_TABLES = [
  /* Sign-in identity. Held apart from users so the address list can be read
     on its own without touching anything else, and so a rename or a cookbook
     move never disturbs it. One address per account, one account per
     address. */
  "CREATE TABLE IF NOT EXISTS user_emails ( email_lc TEXT PRIMARY KEY, email TEXT NOT NULL, " +
    "username_lc TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL )",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_user_emails_user ON user_emails(username_lc)",
  /* One row per signed-in device. The token is the only credential the
     client holds after sign-in; a Cookbook ID no longer opens anything. */
  "CREATE TABLE IF NOT EXISTS sessions ( token TEXT PRIMARY KEY, username_lc TEXT NOT NULL, " +
    "created_at TEXT NOT NULL, expires_at TEXT NOT NULL )",
  "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(username_lc)",
  /* One row per device that has said yes to notifications. Keyed by the
     endpoint the browser hands out, because that is the only identifier the
     push service knows us by; a device that reinstalls gets a new one and the
     old row is dropped the first time it answers Gone. Held per person rather
     than per cookbook: two people sharing a cookbook are still two phones.
     kinds is what that device wants to be told about, as a JSON list; empty
     means it has never said, which is taken as all of them. */
  "CREATE TABLE IF NOT EXISTS push_subs ( endpoint TEXT PRIMARY KEY, username_lc TEXT NOT NULL, " +
    "p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL, " +
    "kinds TEXT NOT NULL DEFAULT '' )",
  "CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subs(username_lc)",
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
  "CREATE INDEX IF NOT EXISTS idx_mdishes_entry ON meal_dishes(entry_id)",
  /* One rating per cookbook per recipe, kept apart from the cook log. A
     household has an opinion about a dish; it has many evenings of cooking
     it. Tying the two together meant a fourth cook could not be logged
     without restating the verdict, and the verdict could not be revised
     without inventing a cook that never happened. */
  "CREATE TABLE IF NOT EXISTS recipe_ratings ( cookbook_id TEXT NOT NULL, recipe_id TEXT NOT NULL, " +
    "rating INTEGER NOT NULL, rated_by TEXT NOT NULL, updated_at TEXT NOT NULL, " +
    "PRIMARY KEY (cookbook_id, recipe_id) )",
  "CREATE INDEX IF NOT EXISTS idx_ratings_recipe ON recipe_ratings(recipe_id)",
  /* One-shot data moves, recorded so they never run twice. The column
     backfills below are self-describing - an unfilled column is NULL - but
     moving the old per-entry ratings across is not: rerunning it would
     resurrect a rating somebody had deliberately cleared. */
  "CREATE TABLE IF NOT EXISTS migrations ( name TEXT PRIMARY KEY, done_at TEXT NOT NULL )",
  /* Asking "is there anything left to backfill" used to read every recipe in
     the database, because tags is not indexed and NULL is not a value an
     ordinary index can be searched for. Partial, so it holds only the rows
     that still need filling and is empty - costing nothing to store and
     nothing to maintain - the moment the backfill finishes. */
  "CREATE INDEX IF NOT EXISTS idx_recipes_unfilled ON recipes(recipe_id) WHERE tags IS NULL"
];

/* What a kitchen is assumed to have until it says otherwise. Seeded on read
   rather than written at signup, so a cookbook that predates the feature
   gets them too. Once the list has been saved even once - emptied included -
   the stored answer wins and these are never reapplied. */
const DEFAULT_EXCLUSIONS = ["Water", "Salt", "Black pepper", "Baking soda", "Ice"];
const MAX_EXCLUSIONS = 200;
let schemaReady = false;
let schemaBooted = false;
/* community_meals shipped before it had anything to say beyond a name and a
   day. The table is already live, so the two later columns are added rather
   than declared: CREATE TABLE IF NOT EXISTS never runs again once the table
   exists, and would leave a cookbook created last month without them. SQLite
   has no ADD COLUMN IF NOT EXISTS, and a duplicate column is the expected
   result on every run after the first, so that one error is swallowed and
   anything else is not. */
/* The three summary columns are what the cupboard tab is built from. They
   are deliberately nullable rather than NOT NULL DEFAULT '': a NULL is the
   signal that this row predates the columns and still needs filling from its
   data blob, and an empty description is a real answer that must not be
   mistaken for a missing one. */
const LATER_COLUMNS = [
  "ALTER TABLE users ADD COLUMN pw_hash TEXT",
  "ALTER TABLE users ADD COLUMN pw_salt TEXT",
  "ALTER TABLE users ADD COLUMN pw_updated_at TEXT",
  "ALTER TABLE community_meals ADD COLUMN description TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE community_meals ADD COLUMN location TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE recipes ADD COLUMN description TEXT",
  "ALTER TABLE recipes ADD COLUMN tags TEXT",
  "ALTER TABLE recipes ADD COLUMN ing_names TEXT"
];
/* Reading a recipe's data blob to answer "what is this called and what is in
   it" is the thing the whole change is trying to stop doing on every sync.
   Once, at rest, is fine; a few thousand at a time keeps a cold start from
   turning into a minute of parsing, and whatever is left is picked up on the
   next one. */
const BACKFILL_CHUNK = 200;
const BACKFILL_MAX = 2000;
/* True when there is nothing left to fill. The version stamp waits on that
   answer: a box big enough to need more than BACKFILL_MAX rows in one pass
   must be allowed to finish on a later cold start, and stamping early would
   close the door on it. */
async function backfillRecipeSummaries(env) {
  let done = 0;
  while (done < BACKFILL_MAX) {
    const rows = (await env.DB.prepare(
      "SELECT recipe_id, data FROM recipes WHERE tags IS NULL LIMIT " + BACKFILL_CHUNK
    ).all()).results || [];
    if (!rows.length) return true;
    const statements = [];
    for (const row of rows) {
      let data = null;
      try { data = JSON.parse(row.data); } catch (e) { data = {}; }
      const s = summaryOf(data);
      statements.push(env.DB.prepare(
        "UPDATE recipes SET description = ?, tags = ?, ing_names = ? WHERE recipe_id = ?"
      ).bind(s.description, s.tags, s.ingNames, row.recipe_id));
    }
    await env.DB.batch(statements);
    done += rows.length;
    if (rows.length < BACKFILL_CHUNK) return true;
  }
  return false;
}
/* Every rating ever left on a cook log entry, collapsed to one per cookbook:
   the most recent word a household said about a dish is the word it still
   stands by. Guarded by the migrations table because a cleared rating is a
   deletion, and an unguarded rerun would undo it. */
const RATING_MIGRATION = "ratings-from-cook-log-v1";
async function backfillRatings(env) {
  const seen = await env.DB.prepare(
    "SELECT name FROM migrations WHERE name = ?"
  ).bind(RATING_MIGRATION).first();
  if (seen) return;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO recipe_ratings (cookbook_id, recipe_id, rating, rated_by, updated_at) " +
    "SELECT u.cookbook_id, c.recipe_id, c.rating, c.username, c.created_at FROM comments c " +
    "JOIN users u ON u.username_lc = c.username_lc WHERE c.rating BETWEEN 1 AND 5 " +
    "AND c.created_at = (SELECT MAX(c2.created_at) FROM comments c2 " +
    "JOIN users u2 ON u2.username_lc = c2.username_lc " +
    "WHERE c2.recipe_id = c.recipe_id AND u2.cookbook_id = u.cookbook_id AND c2.rating BETWEEN 1 AND 5)"
  ).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO migrations (name, done_at) VALUES (?, ?)"
  ).bind(RATING_MIGRATION, new Date().toISOString()).run();
}
async function addLaterColumns(env) {
  for (const sql of LATER_COLUMNS) {
    try { await env.DB.prepare(sql).run(); }
    catch (e) {
      if (!/duplicate column/i.test(String(e && e.message))) throw e;
    }
  }
  await env.DB.prepare(VISIBILITY_MIGRATION).run();
}
/* ------------------------------------------------------- schema version --
   The bootstrap below used to run once per isolate, which is not the same
   thing as once. Every cold start replayed thirty-odd DDL statements, five
   ALTERs that are expected to fail, an UPDATE across the recipes table and a
   probe that read every recipe row - to do nothing, because it had all been
   done months ago. That is a few hundred milliseconds on the unlucky request
   and a full table scan billed as rows read, repeated for the life of the
   Worker and growing with the size of the box.

   So it is stamped instead. One row in migrations says which version of the
   shape the database is already at; if it matches, the bootstrap is skipped
   outright and a cold start costs a single indexed lookup.

   READ THIS BEFORE ADDING A TABLE, AN INDEX OR A COLUMN: adding it to
   LATER_TABLES or LATER_COLUMNS is no longer enough on its own. The stamp
   already in the database will match, the bootstrap will be skipped, and the
   new thing will never be created. Bump SCHEMA_VERSION in the same change
   and the next request applies it. */
const SCHEMA_VERSION = "schema-v3";
async function schemaStamped(env) {
  try {
    const row = await env.DB.prepare(
      "SELECT name FROM migrations WHERE name = ?"
    ).bind(SCHEMA_VERSION).first();
    return !!row;
  } catch (e) {
    /* No migrations table yet - a database from before any of this. */
    return false;
  }
}
async function ensureSchema(env) {
  if (schemaReady) return;
  if (await schemaStamped(env)) { schemaReady = true; return; }
  /* The shape only has to be declared once per isolate even when the data
     move behind it has not finished; replaying the DDL on every request
     while a large backfill drains would be its own version of the problem
     this change exists to remove. */
  if (!schemaBooted) {
    for (const sql of LATER_TABLES) await env.DB.prepare(sql).run();
    await addLaterColumns(env);
    schemaBooted = true;
  }
  const drained = await backfillRecipeSummaries(env);
  await backfillRatings(env);
  /* Only claim the shape is settled once the backfill actually finished.
     Until then the next cold start picks up where this one stopped. */
  if (drained) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO migrations (name, done_at) VALUES (?, ?)"
    ).bind(SCHEMA_VERSION, new Date().toISOString()).run();
    schemaReady = true;
  }
}

const MARK_KINDS = ["pin", "star", "later"];

/* Every meal this cookbook is on the guest list for, with its whole guest
   list and everything anyone is bringing. Membership is the only permission
   involved: two guests who are not friends still read the same tile, because
   a shared dinner is not a private thing between each pair of people at it.
   What crosses that line is deliberately narrow - a household name and a
   dish title. No recipe, no servings, no cookbook contents. */
const MEAL_GUEST_SEATS_SQL =
  "SELECT meal_id, status, updated_at FROM meal_guests " +
  "WHERE cookbook_id = ? AND status != 'declined'";
/* seats may be handed in already read - the library sync fetches it in the
   same batch as everything else it needs - so this does not go and ask a
   second time for something already in hand. */
async function mealsFor(env, cookbookId, seats) {
  const mine = seats || (await env.DB.prepare(
    MEAL_GUEST_SEATS_SQL
  ).bind(cookbookId).all()).results || [];
  if (!mine.length) return { meals: [], cookbooks: [] };
  const ids = mine.map(r => r.meal_id);
  const myStatus = {}, myAt = {};
  for (const r of mine) { myStatus[r.meal_id] = r.status; myAt[r.meal_id] = r.updated_at; }

  /* Three fan-outs over the same list of meals, so they travel together
     rather than as three trips to the same place. */
  const parts = chunked(ids);
  const meta = [], guests = [], dishes = [];
  for (const part of parts) {
    const ph = placeholders(part.length);
    meta.push(env.DB.prepare(
      "SELECT meal_id, owner_cb, title, on_date, at_time, description, location, " +
      "created_by, created_at, updated_at " +
      "FROM community_meals WHERE meal_id IN (" + ph + ")"
    ).bind(...part));
    guests.push(env.DB.prepare(
      "SELECT meal_id, cookbook_id, status, updated_at FROM meal_guests WHERE meal_id IN (" + ph + ")"
    ).bind(...part));
    dishes.push(env.DB.prepare(
      "SELECT dish_id, meal_id, cookbook_id, recipe_id, title, entry_id, created_by, created_at " +
      "FROM meal_dishes WHERE meal_id IN (" + ph + ") ORDER BY created_at"
    ).bind(...part));
  }
  /* A batch answers in the order it was asked, so the three groups are told
     apart by where they sit rather than by what they contain. */
  const res = await env.DB.batch(meta.concat(guests, dishes));
  const rowsAt = (from, count) => {
    const out = [];
    for (let i = from; i < from + count; i++) {
      for (const row of ((res[i] && res[i].results) || [])) out.push(row);
    }
    return out;
  };
  const n = parts.length;
  const metaRows = rowsAt(0, n);
  const guestRows = rowsAt(n, n);
  /* Chunking split the ORDER BY, so the order is restored here. */
  const dishRows = rowsAt(2 * n, n)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

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

/* ==================================================== push notifications = */
/* Web Push done with nothing but WebCrypto, so there is no library to bundle
   into a file that is pasted into a dashboard: RFC 8292 for the VAPID
   signature that identifies this server to Apple and Google, RFC 8291 for the
   aes128gcm envelope that keeps the message unreadable to them. Neither of
   them ever sees the text.

   Everything here swallows its own errors. A push is a courtesy; it must
   never be the reason a friend request or a cook log fails to save. */
const PUSH_TTL = 86400;          /* a day: past that it is no longer news */
const PUSH_FANOUT = 40;          /* D1 takes about fifty binds in one go */
/* Everything a notification can be about. The client shows one switch per
   entry, so this list and the labels beside them are the same six things. */
const PUSH_KINDS = ["friendAsk", "friendYes", "mealAsk", "mealYes", "cook", "recipe"];

function cleanKinds(value) {
  const list = Array.isArray(value) ? value : [];
  return PUSH_KINDS.filter(function (k) { return list.indexOf(k) >= 0; });
}
/* A stored list of nothing and a stored list never written are different
   things: the first is somebody who turned everything off, the second is a
   device from before there were switches. Only the second means all. */
function wantsKind(row, kind) {
  if (!kind) return true;
  if (!row || !row.kinds) return true;
  let list;
  try { list = JSON.parse(row.kinds); } catch (e) { return true; }
  if (!Array.isArray(list)) return true;
  return list.indexOf(kind) >= 0;
}
/* The same reading, but for telling the client. A device that has never said
   is shown every switch on, which is what it is actually getting. */
function readKinds(stored) {
  if (!stored) return PUSH_KINDS.slice();
  try {
    const list = JSON.parse(stored);
    return Array.isArray(list) ? cleanKinds(list) : PUSH_KINDS.slice();
  } catch (e) { return PUSH_KINDS.slice(); }
}
async function kindsFor(env, endpoint, usernameLc) {
  try {
    const row = await env.DB.prepare(
      "SELECT kinds FROM push_subs WHERE endpoint = ? AND username_lc = ?"
    ).bind(endpoint, usernameLc).first();
    return readKinds(row && row.kinds);
  } catch (e) { return PUSH_KINDS.slice(); }
}

function b64urlToBytes(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = (t.length % 4) ? "====".slice(t.length % 4) : "";
  const bin = atob(t + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  const b = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function joinBytes(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
async function hmacBytes(keyBytes, data) {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/* The server's own identity, rebuilt from the two secrets. The public half is
   stored as the raw 65-byte point the browser wants for applicationServerKey,
   so the JWK coordinates are cut back out of it rather than kept twice. */
async function vapidKeys(env) {
  if (!env || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  try {
    const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY);
    if (pub.length !== 65) return null;
    const key = await crypto.subtle.importKey("jwk", {
      kty: "EC", crv: "P-256", d: String(env.VAPID_PRIVATE_KEY),
      x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65))
    }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    return { key: key, pub: String(env.VAPID_PUBLIC_KEY) };
  } catch (e) { return null; }
}
async function vapidHeader(env, keys, endpoint) {
  const enc = new TextEncoder();
  const head = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: env.VAPID_SUBJECT || "mailto:kindredcupboard@gmail.com"
  })));
  const signed = head + "." + claims;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.key, enc.encode(signed));
  return "vapid t=" + signed + "." + bytesToB64url(new Uint8Array(sig)) + ", k=" + keys.pub;
}

/* One message, sealed to one device. A throwaway keypair per send agrees a
   secret with that device's public key; the shared secret and the device's
   own auth secret are stretched into a content key and a nonce, and the
   result is a single aes128gcm record with the body laid out in front of it
   exactly as the spec orders it. */
async function encryptPush(text, p256dh, authSecretB64) {
  const enc = new TextEncoder();
  const uaPub = b64urlToBytes(p256dh);
  const authSecret = b64urlToBytes(authSecretB64);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));

  const prkKey = await hmacBytes(authSecret, shared);
  const ikm = await hmacBytes(prkKey, joinBytes([
    enc.encode("WebPush: info\u0000"), uaPub, asPub, new Uint8Array([1])
  ]));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacBytes(salt, ikm);
  const cek = (await hmacBytes(prk, joinBytes([
    enc.encode("Content-Encoding: aes128gcm\u0000"), new Uint8Array([1])
  ]))).slice(0, 16);
  const nonce = (await hmacBytes(prk, joinBytes([
    enc.encode("Content-Encoding: nonce\u0000"), new Uint8Array([1])
  ]))).slice(0, 12);

  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  /* 0x02 is the last-record marker; there is only ever one record here. */
  const padded = joinBytes([enc.encode(text), new Uint8Array([2])]);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, padded));
  return joinBytes([salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([65]), asPub, ct]);
}

async function sendOnePush(env, keys, sub, text) {
  let payload, auth;
  try {
    payload = await encryptPush(text, sub.p256dh, sub.auth);
    auth = await vapidHeader(env, keys, sub.endpoint);
  } catch (e) { return; }
  let res;
  try {
    res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Authorization": auth,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": String(PUSH_TTL),
        "Urgency": "normal"
      },
      body: payload
    });
  } catch (e) { return; }
  /* Gone means the browser has thrown the subscription away - an uninstall,
     a cleared site, permission withdrawn. Stop writing to a dead address. */
  if (res && (res.status === 404 || res.status === 410)) {
    try {
      await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(sub.endpoint).run();
    } catch (e) {}
  }
}

async function pushToUsers(env, usernameLcs, msg) {
  const names = Array.from(new Set((usernameLcs || []).filter(Boolean)));
  if (!names.length) return;
  const keys = await vapidKeys(env);
  if (!keys) return;                  /* no keys configured: quietly nothing */
  const text = JSON.stringify(msg);
  for (let i = 0; i < names.length; i += PUSH_FANOUT) {
    const slice = names.slice(i, i + PUSH_FANOUT);
    let rows;
    try {
      rows = await env.DB.prepare(
        "SELECT endpoint, p256dh, auth, kinds FROM push_subs WHERE username_lc IN (" +
        placeholders(slice.length) + ")"
      ).bind(...slice).all();
    } catch (e) { return; }
    for (const sub of (rows && rows.results) || []) {
      if (wantsKind(sub, msg && msg.kind)) await sendOnePush(env, keys, sub, text);
    }
  }
}

/* Most things worth announcing happen between cookbooks, but a notification
   arrives on a person's phone, so the cookbook is opened out into its people
   first. The one who caused it is left out - nobody needs telling what they
   just did. */
async function usersInCookbooks(env, cookbookIds, exceptLc) {
  const ids = Array.from(new Set((cookbookIds || []).filter(Boolean)));
  const out = [];
  for (let i = 0; i < ids.length; i += PUSH_FANOUT) {
    const slice = ids.slice(i, i + PUSH_FANOUT);
    const rows = await env.DB.prepare(
      "SELECT username_lc FROM users WHERE cookbook_id IN (" + placeholders(slice.length) + ")"
    ).bind(...slice).all();
    for (const r of (rows && rows.results) || []) {
      if (r.username_lc !== exceptLc) out.push(r.username_lc);
    }
  }
  return out;
}
async function pushToCookbooks(env, cookbookIds, exceptLc, msg) {
  try {
    await pushToUsers(env, await usersInCookbooks(env, cookbookIds, exceptLc), msg);
  } catch (e) {}
}

/* Which friends should hear that a recipe has appeared. Linking cookbooks
   hands over everything already in them at once, and fifty recipes announced
   fifty times is not news, it is a fault. So the moment of the handshake is
   compared against the moment the recipe was written: anything that was
   already there when you linked up belongs to the introduction, and only
   what comes afterwards is worth a phone lighting up. A recipe made now
   clears every handshake there is, which is why the ordinary case needs no
   thought at all. */
async function friendsToTell(env, cookbookId, createdAt) {
  const rows = await env.DB.prepare(
    "SELECT CASE WHEN requester_cb = ? THEN addressee_cb ELSE requester_cb END AS cb, updated_at " +
    "FROM friendships WHERE status = 'accepted' AND (requester_cb = ? OR addressee_cb = ?)"
  ).bind(cookbookId, cookbookId, cookbookId).all();
  return ((rows && rows.results) || [])
    .filter(function (r) { return r.updated_at && String(r.updated_at) < String(createdAt); })
    .map(function (r) { return r.cb; });
}
/* The name a cookbook goes by on somebody else's shelf. */
async function labelOfCookbook(env, cookbookId, fallback) {
  try {
    const map = await membersOf(env, [cookbookId]);
    return householdLabel(map[cookbookId] || [fallback]);
  } catch (e) { return fallback; }
}
async function announceRecipes(env, me, createdAt, one, count) {
  const cbs = await friendsToTell(env, me.cookbookId, createdAt);
  if (!cbs.length) return;
  const label = await labelOfCookbook(env, me.cookbookId, me.username);
  const msg = (count === 1 && one)
    ? { title: me.username + " shared " + one.title,
        body: "It is on their shelf in your box now.",
        url: "/?n=recipe:" + one.recipeId, tag: "recipe:" + one.recipeId }
    : { title: me.username + " shared " + count + " recipes",
        body: "They are on their shelf in your box now.",
        url: "/?n=shelf:" + encodeURIComponent(label), tag: "recipes:" + me.cookbookId };
  msg.kind = "recipe";
  await pushToCookbooks(env, cbs, null, msg);
}

/* Hands the work to the runtime so the person who triggered it is not kept
   waiting on somebody else's phone. Without a context - the test harnesses
   have none - it simply runs, and its failures stay swallowed. */
function pushLater(ctx, work) {
  const p = Promise.resolve().then(work).catch(function () {});
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
  return p;
}

async function handleApi(route, body, env, request, ctx) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await ensureSchema(env);

  /* ---- create an account ----
     Three ways in, all through this one door:
       - on your own: a fresh cookbook is made for you;
       - joining a household: an existing Cookbook ID with room in it;
       - claiming: a name and Cookbook ID that already exist together and have
         never had an address attached. That is the migration path off the old
         Cookbook-ID-as-password scheme, and it is meant to be removed once
         everybody who had an account before has been through it. */
  if (route === "auth/signup") {
    await throttleGuard(env, ["ip:" + ip]);
    const username = normalizeUsername(body.name);
    const email = cleanString(body.email, 160);
    const emailLc = email.toLowerCase();
    const clientHash = cleanString(body.clientHash, 80);
    const wantsJoin = body.joinCookbook === true;
    const cookbookId = cleanString(body.cookbookId, 40).toUpperCase();

    if (!USERNAME_RE.test(username)) {
      throw new ApiError(400, USERNAME_RULE);
    }
    if (!EMAIL_RE.test(email)) throw new ApiError(400, "That does not look like an email address.");
    if (cleanString(body.emailConfirm, 160).toLowerCase() !== emailLc) {
      throw new ApiError(400, "The two email addresses do not match.");
    }
    if (!CLIENT_HASH_RE.test(clientHash)) {
      throw new ApiError(400, "That password could not be read. Try again on a current browser.");
    }
    const emailTaken = await env.DB.prepare(
      "SELECT username_lc FROM user_emails WHERE email_lc = ?"
    ).bind(emailLc).first();
    if (emailTaken) {
      throw new ApiError(409, "There is already an account on that email address. Sign in as an existing user instead.");
    }

    const nameLc = username.toLowerCase();
    const byName = await env.DB.prepare(
      "SELECT username, username_lc, cookbook_id FROM users WHERE username_lc = ?"
    ).bind(nameLc).first();
    const now = new Date().toISOString();
    let finalCookbook = "", created = false, joined = false, claimed = false;

    if (wantsJoin) {
      const bucket = "cbtry:" + ip;
      await attemptGuard(env, bucket, BAD_COOKBOOK_TRIES, "Cookbook IDs tried");
      if (!COOKBOOK_RE.test(cookbookId)) {
        await throttleRecordFailure(env, [bucket]);
        throw new ApiError(400, "A Cookbook ID is 10 characters, letters and numbers only.");
      }
      const existing = await countMembers(env, cookbookId);
      if (existing === 0) {
        await throttleRecordFailure(env, [bucket]);
        throw new ApiError(404, "No cookbook has that ID. Check it with whoever sent it to you.");
      }
      if (byName && byName.cookbook_id === cookbookId) {
        /* The claim. Only ever available to a row with no address on it. */
        const already = await emailRowFor(env, nameLc);
        if (already) {
          throw new ApiError(409, "That name already has an account. Sign in as an existing user instead.");
        }
        finalCookbook = cookbookId;
        claimed = true;
      } else {
        if (byName) {
          throw new ApiError(409, "Somebody already uses that name. Pick another.");
        }
        if (existing >= MAX_COOKBOOK_MEMBERS) {
          throw new ApiError(409, "That cookbook already has " + MAX_COOKBOOK_MEMBERS +
            " people in it, which is the limit. Ask them to add you as a friend instead.");
        }
        finalCookbook = cookbookId;
        joined = true;
      }
    } else {
      if (byName) throw new ApiError(409, "Somebody already uses that name. Pick another.");
      for (let tries = 0; tries < 6 && !finalCookbook; tries++) {
        const candidate = randomFrom(COOKBOOK_ALPHABET, 10);
        if ((await countMembers(env, candidate)) === 0) finalCookbook = candidate;
      }
      if (!finalCookbook) throw new ApiError(500, "Could not start a cookbook just now. Try again.");
      created = true;
    }

    if (!claimed) {
      await env.DB.prepare(
        "INSERT INTO users (username_lc, username, cookbook_id, created_at) VALUES (?, ?, ?, ?)"
      ).bind(nameLc, username, finalCookbook, now).run();
    }
    await env.DB.prepare(
      "INSERT INTO user_emails (email_lc, email, username_lc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(emailLc, email, nameLc, now, now).run();
    await setPassword(env, nameLc, clientHash);
    const token = await startSession(env, nameLc);
    return jsonResponse({
      token, username: (byName && claimed) ? byName.username : username,
      cookbookId: finalCookbook, email,
      created, joined, claimed, members: await countMembers(env, finalCookbook)
    });
  }

  /* ---- sign in ----
     One message for a wrong address and a wrong password alike, so the reply
     never says which addresses have accounts on them. */
  if (route === "auth/login") {
    await throttleGuard(env, ["ip:" + ip]);
    const email = cleanString(body.email, 160).toLowerCase();
    const clientHash = cleanString(body.clientHash, 80);
    const wrong = new ApiError(401, "That email address and password do not go together.");
    if (!EMAIL_RE.test(email) || !CLIENT_HASH_RE.test(clientHash)) throw wrong;
    const row = await env.DB.prepare(
      "SELECT e.email AS email, u.username AS username, u.username_lc AS username_lc, " +
      "u.cookbook_id AS cookbook_id, u.pw_hash AS pw_hash, u.pw_salt AS pw_salt " +
      "FROM user_emails e JOIN users u ON u.username_lc = e.username_lc WHERE e.email_lc = ?"
    ).bind(email).first();
    if (!row || !row.pw_hash || !row.pw_salt) {
      await throttleRecordFailure(env, ["ip:" + ip]);
      throw wrong;
    }
    if (!sameSecret(await serverHash(row.pw_salt, clientHash), row.pw_hash)) {
      await throttleRecordFailure(env, ["ip:" + ip]);
      throw wrong;
    }
    const token = await startSession(env, row.username_lc);
    return jsonResponse({
      token, username: row.username, cookbookId: row.cookbook_id, email: row.email,
      members: await countMembers(env, row.cookbook_id)
    });
  }

  /* ---- sign out ----
     Answers the same way whether or not the token was real, so signing out
     twice is not an error worth showing anybody. */
  /* ---- notifications on a device ----
     The public key is public by definition: the browser has to hand it to
     the push service before it will issue a subscription at all. It is
     answered without a session so the settings panel can tell whether the
     feature is switched on at the server before asking anybody for
     permission. */
  if (route === "push/key") {
    return jsonResponse({ key: (env && env.VAPID_PUBLIC_KEY) || "" });
  }

  /* Saying yes on a device. Keyed by endpoint, so the same phone answering
     twice replaces its row rather than collecting them, and a phone that
     moves to another account moves with it. */
  if (route === "push/subscribe") {
    const who = await requireAuth(env, body);
    const endpoint = cleanString(body.endpoint, 800);
    const p256dh = cleanString(body.p256dh, 200);
    const auth = cleanString(body.auth, 100);
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) {
      throw new ApiError(400, "That subscription was not readable.");
    }
    await env.DB.prepare(
      "INSERT INTO push_subs (endpoint, username_lc, p256dh, auth, created_at, kinds) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(endpoint) DO UPDATE SET username_lc = excluded.username_lc, " +
      "p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at"
    ).bind(endpoint, who.usernameLc, p256dh, auth, new Date().toISOString(),
      JSON.stringify(PUSH_KINDS)).run();
    /* Note what the conflict branch leaves alone: a device signing itself up
       again keeps the switches it had set. */
    return jsonResponse({ ok: true, subscribed: true, kinds: await kindsFor(env, endpoint, who.usernameLc) });
  }

  /* What this device is signed up for, if anything. Asked when the settings
     panel opens, because permission and subscription can both be changed
     from outside the app. */
  if (route === "push/status") {
    const who = await requireAuth(env, body);
    const endpoint = cleanString(body.endpoint, 800);
    const row = endpoint ? await env.DB.prepare(
      "SELECT kinds FROM push_subs WHERE endpoint = ? AND username_lc = ?"
    ).bind(endpoint, who.usernameLc).first() : null;
    return jsonResponse({
      ok: true, subscribed: !!row,
      kinds: row ? readKinds(row.kinds) : PUSH_KINDS.slice()
    });
  }

  /* Which of the six this device wants. Held against the endpoint rather
     than the account, so a phone and a laptop can want different things. */
  if (route === "push/prefs") {
    const who = await requireAuth(env, body);
    const endpoint = cleanString(body.endpoint, 800);
    if (!endpoint) throw new ApiError(400, "That subscription was not readable.");
    const kinds = cleanKinds(body.kinds);
    const res = await env.DB.prepare(
      "UPDATE push_subs SET kinds = ? WHERE endpoint = ? AND username_lc = ?"
    ).bind(JSON.stringify(kinds), endpoint, who.usernameLc).run();
    if (!res.meta || res.meta.changes === 0) {
      throw new ApiError(404, "This device is not signed up for notifications.");
    }
    return jsonResponse({ ok: true, kinds });
  }

  /* Turning it off again. Only ever removes this device's own row, and says
     the same thing whether there was one or not. */
  if (route === "push/unsubscribe") {
    const who = await requireAuth(env, body);
    const endpoint = cleanString(body.endpoint, 800);
    if (endpoint) {
      await env.DB.prepare(
        "DELETE FROM push_subs WHERE endpoint = ? AND username_lc = ?"
      ).bind(endpoint, who.usernameLc).run();
    }
    return jsonResponse({ ok: true, subscribed: false });
  }

  if (route === "auth/logout") {
    const token = cleanString(body.token, 80);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return jsonResponse({ signedOut: true });
  }

  /* ---- admin: hand somebody a temporary password ----
     There is no mail out of here, so recovery is a person writing in from the
     address on their account and being given something to sign in with. The
     browser derives the hash from that address and the temporary password
     exactly as the sign-in screen would, so this route never sees either. */
  if (route === "admin/password") {
    const token = cleanString(body.token, 200);
    if (!env.ADMIN_TOKEN || !token || token !== env.ADMIN_TOKEN) {
      throw new ApiError(403, "That is not the admin token.");
    }
    const email = cleanString(body.email, 160).toLowerCase();
    const clientHash = cleanString(body.clientHash, 80);
    if (!EMAIL_RE.test(email)) throw new ApiError(400, "That does not look like an email address.");
    if (!CLIENT_HASH_RE.test(clientHash)) throw new ApiError(400, "That password could not be read.");
    const row = await env.DB.prepare(
      "SELECT username_lc FROM user_emails WHERE email_lc = ?"
    ).bind(email).first();
    if (!row) throw new ApiError(404, "No account on that address.");
    await setPassword(env, row.username_lc, clientHash);
    await dropOtherSessions(env, row.username_lc, "");
    return jsonResponse({ reset: true, username: row.username_lc });
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
    /* A sync used to be nineteen statements sent one after another, each
       waiting on the answer to the last before it was even dispatched.
       Almost none of them actually depended on each other - they only
       depended on knowing which cookbook was asking, which is settled before
       any of them run - so the wait was the round trip and nothing else. A
       D1 database serves one query at a time whatever happens, so this does
       not make the database do less work; it stops the request paying the
       distance to it fourteen times over.

       Three things genuinely do have to wait, and still do: the meals need
       the seats before they know which meals to read, the household names
       need the friend and guest lists before they know whose names to ask
       for, and both of those come from this batch. */
    const reach = visibleRecipeClause(me.cookbookId, "");
    const voices = voicesClause(me.cookbookId);
    const rateReach = visibleRecipeClause(me.cookbookId, "r.");
    const cookReach = visibleRecipeClause(me.cookbookId, "r.");
    const feedSince = new Date(Date.now() - COOK_FEED_DAYS * 86400000).toISOString();

    const first = await env.DB.batch([
      /* Accepted links, with when each was made. The friend list and the
         reach stamp are both read off this, so it is asked once. */
      env.DB.prepare(
        "SELECT CASE WHEN requester_cb = ? THEN addressee_cb ELSE requester_cb END AS cb, updated_at " +
        "FROM friendships WHERE status = 'accepted' AND (requester_cb = ? OR addressee_cb = ?)"
      ).bind(me.cookbookId, me.cookbookId, me.cookbookId),
      env.DB.prepare(
        "SELECT requester_cb, requested_by, created_at FROM friendships " +
        "WHERE addressee_cb = ? AND status = 'pending' ORDER BY created_at"
      ).bind(me.cookbookId),
      env.DB.prepare(
        "SELECT addressee_cb, created_at FROM friendships " +
        "WHERE requester_cb = ? AND status = 'pending' ORDER BY created_at"
      ).bind(me.cookbookId),
      env.DB.prepare(
        "SELECT requester_cb, requested_by FROM friendships " +
        "WHERE addressee_cb = ? AND status = 'declined'"
      ).bind(me.cookbookId),
      env.DB.prepare(MEAL_GUEST_SEATS_SQL).bind(me.cookbookId),
      /* Nothing here reads the data blob. A card needs a name, a line of
         description, its tags and two numbers, and that is exactly what
         comes back - so opening the app costs one small row per recipe
         instead of every ingredient and every step of every recipe anyone
         can see. */
      env.DB.prepare(
        "SELECT recipe_id, cookbook_id, owner_username, visibility, title, description, tags, " +
        "ing_names, created_at, updated_at, updated_by FROM recipes WHERE " + reach.clause
      ).bind(...reach.binds),
      /* Ratings and cooks are visible between linked cookbooks, so a new
         member of a cookbook can see everything that cookbook could already
         see. Both arrive as totals rather than as rows: the box tab wants an
         average and a count, and the entries behind them are fetched only
         when a recipe is actually opened. */
      env.DB.prepare(
        "SELECT rt.recipe_id, rt.cookbook_id, rt.rating FROM recipe_ratings rt " +
        "JOIN recipes r ON r.recipe_id = rt.recipe_id " +
        "WHERE (" + rateReach.clause + ") AND rt.cookbook_id IN (" + voices.sql + ")"
      ).bind(...rateReach.binds, ...voices.binds),
      env.DB.prepare(
        "SELECT c.recipe_id, COUNT(*) AS n, MAX(c.cooked_on) AS last, " +
        "SUM(CASE WHEN u.cookbook_id = ? THEN 1 ELSE 0 END) AS ourn " +
        "FROM comments c JOIN recipes r ON r.recipe_id = c.recipe_id " +
        "JOIN users u ON u.username_lc = c.username_lc " +
        "WHERE (" + cookReach.clause + ") AND u.cookbook_id IN (" + voices.sql + ") GROUP BY c.recipe_id"
      ).bind(me.cookbookId, ...cookReach.binds, ...voices.binds),
      /* The only cook log entries that still travel with a sync: recent
         cooks by somebody else on a recipe of ours, which is the one thing
         the notifications page cannot work out for itself. Everything older
         has already been read once and is a scroll through the recipe
         away. */
      env.DB.prepare(
        "SELECT c.comment_id, c.recipe_id, c.username, c.comment, c.cooked_on, c.created_at " +
        "FROM comments c JOIN recipes r ON r.recipe_id = c.recipe_id " +
        "JOIN users u ON u.username_lc = c.username_lc " +
        "WHERE r.cookbook_id = ? AND u.cookbook_id IN (" + voices.sql + ") AND c.username_lc != ? " +
        "AND c.created_at >= ? ORDER BY c.created_at DESC LIMIT " + COOK_FEED_MAX
      ).bind(me.cookbookId, ...voices.binds, me.usernameLc, feedSince),
      /* Marks belong to the cookbook, not the person: a household stars once. */
      env.DB.prepare(
        "SELECT recipe_id, kind FROM recipe_marks WHERE cookbook_id = ?"
      ).bind(me.cookbookId),
      /* How many other cookbooks have pinned, favorited or saved one of our
         own recipes. A count and nothing more: which cookbooks they are is
         deliberately not returned, so the owner cannot work out who. */
      env.DB.prepare(
        "SELECT m.recipe_id, m.kind, COUNT(*) AS n FROM recipe_marks m " +
        "JOIN recipes r ON r.recipe_id = m.recipe_id " +
        "WHERE r.cookbook_id = ? AND m.cookbook_id != ? GROUP BY m.recipe_id, m.kind"
      ).bind(me.cookbookId, me.cookbookId),
      /* Who our own private recipes have been handed to. */
      env.DB.prepare(
        "SELECT s.recipe_id, s.cookbook_id FROM recipe_shares s " +
        "JOIN recipes r ON r.recipe_id = s.recipe_id WHERE r.cookbook_id = ?"
      ).bind(me.cookbookId),
      /* The whole calendar, and the shelf of shopping lists without their
         contents. A plan is a few dozen rows at most, so it rides along; a
         list's items are fetched when the list is opened, which keeps a year
         of shopping out of every sync. */
      env.DB.prepare(
        "SELECT entry_id, recipe_id, title, on_date, servings, created_by, created_at " +
        "FROM schedule_entries WHERE cookbook_id = ? ORDER BY on_date, created_at"
      ).bind(me.cookbookId),
      env.DB.prepare(
        "SELECT list_id, label, start_date, end_date, item_count, created_by, created_at, updated_at " +
        "FROM grocery_lists WHERE cookbook_id = ? ORDER BY created_at DESC"
      ).bind(me.cookbookId),
      env.DB.prepare(
        "SELECT exclusions FROM cookbook_prefs WHERE cookbook_id = ?"
      ).bind(me.cookbookId)
    ]);
    const at = (i) => (first[i] && first[i].results) || [];
    const sinceRows = at(0);
    const pendingIn = at(1);
    const pendingOut = at(2);
    const declinedRows = at(3);
    const mealSeats = at(4);
    const recipeRows = at(5);
    const ratingRows = at(6);
    const cookRows = at(7);
    const cookFeedRows = at(8);
    const markRows = at(9);
    const markCountRows = at(10);
    const shareRows = at(11);
    const schedRows = at(12);
    const listRows = at(13);
    const prefRow = at(14)[0] || null;

    const friendCbs = sinceRows.map(r => r.cb);

    /* Guest cookbooks on a shared meal need names too, and they are not
       necessarily friends of ours, so they are folded into the same lookup
       rather than fetched separately. */
    const mealRaw = await mealsFor(env, me.cookbookId, mealSeats);

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

    const recipes = recipeRows.map(row => {
      let tags = [];
      try { const p = JSON.parse(row.tags || "[]"); if (Array.isArray(p)) tags = p; } catch (e) { tags = []; }
      return {
        recipeId: row.recipe_id,
        owner: row.owner_username,
        household: labelFor[row.cookbook_id] || row.owner_username,
        ours: row.cookbook_id === me.cookbookId,
        visibility: row.visibility,
        title: row.title || "Untitled recipe",
        description: row.description || "",
        tags,
        ingNames: row.ing_names || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by || row.owner_username
      };
    });

    const ratings = {};
    for (const row of ratingRows) {
      const rec = ratings[row.recipe_id] || (ratings[row.recipe_id] = { sum: 0, count: 0, mine: 0 });
      rec.sum += Number(row.rating) || 0;
      rec.count++;
      if (row.cookbook_id === me.cookbookId) rec.mine = Number(row.rating) || 0;
    }
    for (const id of Object.keys(ratings)) {
      const rec = ratings[id];
      ratings[id] = { avg: rec.count ? rec.sum / rec.count : null, count: rec.count, mine: rec.mine };
    }

    const cooks = {};
    for (const row of cookRows) {
      cooks[row.recipe_id] = {
        count: Number(row.n) || 0,
        ours: Number(row.ourn) || 0,
        last: row.last || null
      };
    }

    const cookFeed = cookFeedRows.map(c => ({
      commentId: c.comment_id, recipeId: c.recipe_id, username: c.username,
      comment: c.comment, cookedOn: c.cooked_on, createdAt: c.created_at
    }));

    const marks = { pin: [], star: [], later: [] };
    for (const m of markRows) if (marks[m.kind]) marks[m.kind].push(m.recipe_id);

    const markCounts = {};
    for (const row of markCountRows) {
      const rec = markCounts[row.recipe_id] || (markCounts[row.recipe_id] = { pin: 0, star: 0, later: 0 });
      if (row.kind in rec) rec[row.kind] = Number(row.n) || 0;
    }

    const shares = {};
    for (const row of shareRows) {
      const label = labelFor[row.cookbook_id];
      if (label) (shares[row.recipe_id] = shares[row.recipe_id] || []).push(label);
    }

    const schedule = schedRows.map(row => ({
      entryId: row.entry_id, recipeId: row.recipe_id, title: row.title,
      date: row.on_date, servings: row.servings, by: row.created_by, createdAt: row.created_at
    }));

    const groceryLists = listRows.map(row => ({
      listId: row.list_id, label: row.label, startDate: row.start_date, endDate: row.end_date,
      itemCount: row.item_count, by: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at
    }));

    let exclusions = DEFAULT_EXCLUSIONS.slice();
    if (prefRow) {
      try {
        const parsed = JSON.parse(prefRow.exclusions);
        if (Array.isArray(parsed)) exclusions = parsed.map(x => String(x));
      } catch (e) { /* a corrupt blob falls back to the defaults */ }
    }

    const mates = (memberMap[me.cookbookId] || []).filter(n => n.toLowerCase() !== me.usernameLc);
    /* When each link was made. The app folds everything a friend had already
       shared before that moment into a single piece of news. Same rows the
       friend list was read from, so it is not asked for twice. */
    const sinceFor = {};
    for (const row of sinceRows) sinceFor[row.cb] = row.updated_at;

    const friends = friendCbs
      .map(cb => ({ label: labelFor[cb], members: memberMap[cb] || [], since: sinceFor[cb] || null }))
      .filter(f => f.label)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

    return jsonResponse({
      me: { username: me.username, cookbookId: me.cookbookId, household: labelFor[me.cookbookId] },
      reach: reachStamp(sinceRows.map(r => r.cb + "@" + r.updated_at)),
      recipes,
      ratings,
      cooks,
      cookFeed,
      marks,
      markCounts,
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
    pushLater(ctx, function () {
      return pushToCookbooks(env, guests, null, {
        title: "You are invited",
        body: me.username + " has asked you to " + (seat.meal.title || "a meal") +
          (seat.meal.on_date ? " on " + seat.meal.on_date : "") + ".",
        url: "/?n=meal:" + mealId, tag: "meal:" + mealId, kind: "mealAsk"
      });
    });
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
    if (answer === "accept") {
      pushLater(ctx, function () {
        return pushToCookbooks(env, [seat.meal.owner_cb], null, {
          title: me.username + " is coming",
          body: "They have accepted " + (seat.meal.title || "your meal") +
            (seat.meal.on_date ? " on " + seat.meal.on_date : "") + ".",
          url: "/?n=meal:" + mealId, tag: "meal:" + mealId, kind: "mealYes"
        });
      });
    }
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

  /* ---- change password ---- */
  if (route === "account/password") {
    const current = cleanString(body.currentClientHash, 80);
    const next = cleanString(body.newClientHash, 80);
    if (!CLIENT_HASH_RE.test(current) || !CLIENT_HASH_RE.test(next)) {
      throw new ApiError(400, "Those passwords could not be read. Try again on a current browser.");
    }
    const row = await env.DB.prepare(
      "SELECT pw_hash, pw_salt FROM users WHERE username_lc = ?"
    ).bind(me.usernameLc).first();
    if (!row || !row.pw_hash || !sameSecret(await serverHash(row.pw_salt, current), row.pw_hash)) {
      throw new ApiError(403, "That is not your current password.");
    }
    if (sameSecret(current, next)) {
      throw new ApiError(400, "The new password is the same as the old one.");
    }
    await setPassword(env, me.usernameLc, next);
    await dropOtherSessions(env, me.usernameLc, me.token);
    return jsonResponse({ changed: true });
  }

  /* ---- change email ----
     The password travels hashed against the OLD address, because that is the
     salt it was set with; the new one is only recorded once it has been
     proved the old one belongs to whoever is asking. */
  if (route === "account/email") {
    const current = cleanString(body.currentEmail, 160).toLowerCase();
    const next = cleanString(body.newEmail, 160);
    const nextLc = next.toLowerCase();
    const clientHash = cleanString(body.clientHash, 80);
    if (!CLIENT_HASH_RE.test(clientHash)) {
      throw new ApiError(400, "That password could not be read. Try again on a current browser.");
    }
    if (!EMAIL_RE.test(next)) throw new ApiError(400, "That does not look like an email address.");
    const mine = await emailRowFor(env, me.usernameLc);
    if (!mine || mine.email_lc !== current) {
      throw new ApiError(403, "That is not the email address on this account.");
    }
    if (nextLc === current) throw new ApiError(400, "That is already your email address.");
    const row = await env.DB.prepare(
      "SELECT pw_hash, pw_salt FROM users WHERE username_lc = ?"
    ).bind(me.usernameLc).first();
    if (!row || !row.pw_hash || !sameSecret(await serverHash(row.pw_salt, clientHash), row.pw_hash)) {
      throw new ApiError(403, "That password is not right.");
    }
    const taken = await env.DB.prepare(
      "SELECT username_lc FROM user_emails WHERE email_lc = ?"
    ).bind(nextLc).first();
    if (taken) throw new ApiError(409, "There is already an account on that email address.");
    await env.DB.prepare(
      "UPDATE user_emails SET email_lc = ?, email = ?, updated_at = ? WHERE username_lc = ?"
    ).bind(nextLc, next, new Date().toISOString(), me.usernameLc).run();
    /* The address is half the password salt, so every stored hash for this
       account is now meaningless. The client re-derives against the new
       address and sends it in the same breath. */
    const rehash = cleanString(body.newClientHash, 80);
    if (!CLIENT_HASH_RE.test(rehash)) {
      throw new ApiError(400, "That password could not be re-read for the new address.");
    }
    await setPassword(env, me.usernameLc, rehash);
    await dropOtherSessions(env, me.usernameLc, me.token);
    return jsonResponse({ changed: true, email: next });
  }

  /* ---- change display name ----
     The username is the key everything else points at, so a rename has to
     travel through every table that stores it. Cookbook membership, and so
     every recipe and friendship, is untouched. */
  if (route === "rename") {
    const next = normalizeUsername(body.newUsername);
    if (!USERNAME_RE.test(next)) {
      throw new ApiError(400, USERNAME_RULE);
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
    /* Both of these point at the name rather than at a row id, so a rename
       that skipped them would strand the account's address and sign every
       device out at once. */
    await env.DB.prepare("UPDATE user_emails SET username_lc = ? WHERE username_lc = ?")
      .bind(nextLc, oldLc).run();
    await env.DB.prepare("UPDATE sessions SET username_lc = ? WHERE username_lc = ?")
      .bind(nextLc, oldLc).run();
    await env.DB.prepare("UPDATE recipes SET owner_username = ?, owner_lc = ? WHERE owner_lc = ?")
      .bind(next, nextLc, oldLc).run();
    await env.DB.prepare("UPDATE recipes SET updated_by = ? WHERE updated_by = ?").bind(next, oldName).run();
    await env.DB.prepare("UPDATE recipes SET locked_by = ? WHERE locked_by = ?").bind(next, oldName).run();
    await env.DB.prepare("UPDATE comments SET username = ?, username_lc = ? WHERE username_lc = ?")
      .bind(next, nextLc, oldLc).run();
    await env.DB.prepare("UPDATE recipe_ratings SET rated_by = ? WHERE rated_by = ?")
      .bind(next, oldName).run();
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
        await env.DB.prepare("UPDATE recipes SET data = ?, tags = ? WHERE recipe_id = ?")
          .bind(JSON.stringify(data), JSON.stringify(after), row.recipe_id).run();
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
    const { title, text, description, tags, ingNames } = validateRecipeData(body.data);
    const now = new Date().toISOString();

    if (body.recipeId) {
      const owned = await env.DB.prepare(
        "SELECT recipe_id, visibility, created_at, updated_at, updated_by, locked_by, locked_at FROM recipes WHERE recipe_id = ? AND cookbook_id = ?"
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
        "UPDATE recipes SET data = ?, title = ?, description = ?, tags = ?, ing_names = ?, " +
        "visibility = ?, updated_at = ?, updated_by = ?, " +
        "locked_by = NULL, locked_at = NULL WHERE recipe_id = ?"
      ).bind(text, title, description, tags, ingNames, visibility, now, me.username, String(body.recipeId)).run();
      await applyVisibilityReach(env, String(body.recipeId), visibility);
      if (visibility === "friends" && owned.visibility !== "friends") {
        pushLater(ctx, function () {
          return announceRecipes(env, me, owned.created_at,
            { recipeId: String(body.recipeId), title: title }, 1);
        });
      }
      return jsonResponse({ recipeId: String(body.recipeId), updatedAt: now });
    }

    const recipeId = newRecipeId();
    await env.DB.prepare(
      "INSERT INTO recipes (recipe_id, cookbook_id, owner_username, owner_lc, visibility, title, description, tags, ing_names, data, created_at, updated_at, updated_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(recipeId, me.cookbookId, me.username, me.usernameLc, visibility, title,
      description, tags, ingNames, text, now, now, me.username).run();
    if (visibility === "friends") {
      pushLater(ctx, function () {
        return announceRecipes(env, me, now, { recipeId: recipeId, title: title }, 1);
      });
    }
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

    const voices = voicesClause(me.cookbookId);
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM comments c JOIN users u ON u.username_lc = c.username_lc " +
      "WHERE c.recipe_id = ? AND u.cookbook_id IN (" + voices.sql + ")"
    ).bind(id, ...voices.binds).first();
    const lastRow = await env.DB.prepare(
      "SELECT c.username FROM comments c JOIN users u ON u.username_lc = c.username_lc " +
      "WHERE c.recipe_id = ? AND u.cookbook_id IN (" + voices.sql + ") " +
      "ORDER BY c.created_at DESC LIMIT 1"
    ).bind(id, ...voices.binds).first();

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
    let firstImported = null;
    for (const item of incoming) {
      const { title, text, description, tags, ingNames } =
        validateRecipeData(item && item.data ? item.data : item && item.body);
      const recipeId = newRecipeId();
      if (!firstImported) firstImported = { recipeId: recipeId, title: title };
      statements.push(env.DB.prepare(
        "INSERT INTO recipes (recipe_id, cookbook_id, owner_username, owner_lc, visibility, title, description, tags, ing_names, data, created_at, updated_at, updated_by) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(recipeId, me.cookbookId, me.username, me.usernameLc, visibility, title,
        description, tags, ingNames, text, now, now, me.username));
      count++;
      /* An imported file may carry the cook log from an older export. A cook
         is a date, so an entry with no rating on it is still an evening that
         happened; only a rating that was actually written is carried across,
         and it lands on the ratings table rather than on the entry. */
      const log = Array.isArray(item.cookLog) ? item.cookLog.slice(0, 200) : [];
      let lastRating = 0;
      for (const entry of log) {
        const rating = Math.min(5, Math.max(0, Math.round(Number(entry && entry.rating) || 0)));
        if (rating) lastRating = rating;
        statements.push(env.DB.prepare(
          "INSERT INTO comments (comment_id, recipe_id, username_lc, username, rating, comment, cooked_on, created_at) " +
          "VALUES (?, ?, ?, ?, 0, ?, ?, ?)"
        ).bind(newCommentId(), recipeId, me.usernameLc, me.username,
          cleanString(entry.notes || entry.comment, MAX_COMMENT_CHARS),
          cleanString(entry.date, 30) || now.slice(0, 10), now));
      }
      if (lastRating) {
        statements.push(env.DB.prepare(
          "INSERT OR REPLACE INTO recipe_ratings (cookbook_id, recipe_id, rating, rated_by, updated_at) " +
          "VALUES (?, ?, ?, ?, ?)"
        ).bind(me.cookbookId, recipeId, lastRating, me.username, now));
      }
    }
    await env.DB.batch(statements);
    if (visibility === "friends" && count) {
      pushLater(ctx, function () {
        return announceRecipes(env, me, now, firstImported, count);
      });
    }
    return jsonResponse({ count });
  }

  /* ---- privacy toggle ---- */
  if (route === "recipe/visibility") {
    const visibility = VISIBILITIES.indexOf(body.visibility) >= 0 ? body.visibility : null;
    if (!visibility) throw new ApiError(400, "Choose private, selective or shared with friends.");
    const recipeId = String(body.recipeId || "");
    const before = await env.DB.prepare(
      "SELECT visibility, title, created_at FROM recipes WHERE recipe_id = ? AND cookbook_id = ?"
    ).bind(recipeId, me.cookbookId).first();
    const res = await env.DB.prepare(
      "UPDATE recipes SET visibility = ?, updated_at = ?, updated_by = ? WHERE recipe_id = ? AND cookbook_id = ?"
    ).bind(visibility, new Date().toISOString(), me.username, recipeId, me.cookbookId).run();
    if (!res.meta || res.meta.changes === 0) throw new ApiError(403, "You can only change recipes in your own cookbook.");
    await applyVisibilityReach(env, recipeId, visibility);
    /* Opening an old recipe up is judged on when it was written, not on when
       the switch was thrown, so a tidy-up of the back catalogue does not
       announce itself to anyone who was already there for it. */
    if (visibility === "friends" && before && before.visibility !== "friends") {
      pushLater(ctx, function () {
        return announceRecipes(env, me, before.created_at,
          { recipeId: recipeId, title: before.title || "a recipe" }, 1);
      });
    }
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
      env.DB.prepare("DELETE FROM recipe_ratings WHERE recipe_id = ?").bind(recipeId),
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
    const { title, text, description, tags, ingNames } = validateRecipeData(data);
    const now = new Date().toISOString();
    const recipeId = newRecipeId();
    await env.DB.prepare(
      "INSERT INTO recipes (recipe_id, cookbook_id, owner_username, owner_lc, visibility, title, description, tags, ing_names, data, created_at, updated_at, updated_by) " +
      "VALUES (?, ?, ?, ?, 'private', ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(recipeId, me.cookbookId, me.username, me.usernameLc, title,
      description, tags, ingNames, text, now, now, me.username).run();
    return jsonResponse({ recipeId });
  }

  /* ---- one recipe, in full ----
     The other half of the slimmed-down library: everything the card left
     behind, fetched when somebody actually opens the recipe. The cook log
     comes with it, because the only place it is ever read is here. */
  if (route === "recipe/body") {
    const found = await loadRecipeForReader(env, me, String(body.recipeId || ""));
    let data;
    try { data = JSON.parse(found.row.data); } catch (e) { throw new ApiError(500, "That recipe could not be read."); }
    const voices = voicesClause(me.cookbookId);
    const logRows = (await env.DB.prepare(
      "SELECT c.comment_id, c.username, c.username_lc, c.comment, c.cooked_on, c.created_at " +
      "FROM comments c JOIN users u ON u.username_lc = c.username_lc " +
      "WHERE c.recipe_id = ? AND u.cookbook_id IN (" + voices.sql + ") " +
      "ORDER BY c.cooked_on DESC, c.created_at DESC"
    ).bind(found.row.recipe_id, ...voices.binds).all()).results || [];
    return jsonResponse({
      recipeId: found.row.recipe_id,
      updatedAt: found.row.updated_at,
      data,
      log: logRows.map(c => ({
        commentId: c.comment_id, username: c.username, mine: c.username_lc === me.usernameLc,
        comment: c.comment, cookedOn: c.cooked_on, createdAt: c.created_at
      }))
    });
  }

  /* ---- several recipes, in full, with no cook logs ----
     What a shopping list and an export need: ingredients in bulk and nothing
     else. Visibility is applied in the statement rather than per recipe, so
     asking for something out of reach returns fewer rows rather than an
     error - the caller is working from its own library listing and a recipe
     can be unshared between the listing and the request. */
  if (route === "recipe/bodies") {
    const ids = Array.isArray(body.recipeIds)
      ? body.recipeIds.map(x => String(x || "")).filter(Boolean).slice(0, MAX_BODY_BATCH) : [];
    if (!ids.length) return jsonResponse({ bodies: [] });
    const reach = visibleRecipeClause(me.cookbookId, "");
    const rows = (await env.DB.prepare(
      "SELECT recipe_id, data, updated_at FROM recipes WHERE recipe_id IN (" +
      placeholders(ids.length) + ") AND (" + reach.clause + ")"
    ).bind(...ids, ...reach.binds).all()).results || [];
    const bodies = [];
    for (const row of rows) {
      let data = null;
      try { data = JSON.parse(row.data); } catch (e) { continue; }
      bodies.push({ recipeId: row.recipe_id, updatedAt: row.updated_at, data });
    }
    return jsonResponse({ bodies });
  }

  /* ---- one rating per cookbook ----
     A verdict, not an event: writing it again replaces it, and zero clears
     it. Only a kitchen that has actually cooked the thing gets to have an
     opinion recorded, which is checked here and not only in the interface. */
  if (route === "recipe/rate") {
    const rating = Math.round(Number(body.rating) || 0);
    if (!(rating >= 0 && rating <= 5)) throw new ApiError(400, "Pick a rating from 1 to 5.");
    const found = await loadRecipeForReader(env, me, String(body.recipeId || ""));
    const recipeId = found.row.recipe_id;
    if (rating === 0) {
      await env.DB.prepare(
        "DELETE FROM recipe_ratings WHERE cookbook_id = ? AND recipe_id = ?"
      ).bind(me.cookbookId, recipeId).run();
      return jsonResponse({ ok: true, rating: 0 });
    }
    const cooked = await env.DB.prepare(
      "SELECT 1 AS n FROM comments c JOIN users u ON u.username_lc = c.username_lc " +
      "WHERE c.recipe_id = ? AND u.cookbook_id = ? LIMIT 1"
    ).bind(recipeId, me.cookbookId).first();
    if (!cooked) throw new ApiError(400, "Log a cook before rating this one.");
    await env.DB.prepare(
      "INSERT OR REPLACE INTO recipe_ratings (cookbook_id, recipe_id, rating, rated_by, updated_at) " +
      "VALUES (?, ?, ?, ?, ?)"
    ).bind(me.cookbookId, recipeId, rating, me.username, new Date().toISOString()).run();
    return jsonResponse({ ok: true, rating });
  }

  /* ---- cook log entries (a date, and a comment if there is one to make) ----
     No rating: an entry records that the thing was cooked on a day, and how
     the household feels about the dish is kept once, in recipe_ratings, so
     that cooking it a fifth time does not mean casting a fifth vote. */
  if (route === "comment/add") {
    const found = await loadRecipeForReader(env, me, String(body.recipeId || ""));
    const cookedOn = /^\d{4}-\d{2}-\d{2}$/.test(body.cookedOn || "") ? body.cookedOn : new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO comments (comment_id, recipe_id, username_lc, username, rating, comment, cooked_on, created_at) " +
      "VALUES (?, ?, ?, ?, 0, ?, ?, ?)"
    ).bind(newCommentId(), found.row.recipe_id, me.usernameLc, me.username,
      cleanString(body.comment, MAX_COMMENT_CHARS), cookedOn, now).run();
    /* The cookbook that owns the recipe hears about it, minus whoever just
       cooked it. This is the same rule the notifications page has always
       used, only now it reaches a phone that is not open. */
    pushLater(ctx, function () {
      let title = "a recipe";
      try { title = JSON.parse(found.row.data).title || title; } catch (e) {}
      return pushToCookbooks(env, [found.row.cookbook_id], me.usernameLc, {
        title: me.username + " cooked " + title,
        body: cleanString(body.comment, 160) || "Logged in the cook log.",
        url: "/?n=cook:" + found.row.recipe_id,
        tag: "cook:" + found.row.recipe_id, kind: "cook"
      });
    });
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
        pushLater(ctx, function () {
          return pushToCookbooks(env, [them.cookbook_id], null, {
            title: "Cookbooks linked",
            body: me.username + " accepted your request. Their shared recipes are in your box now.",
            url: "/?n=friends", tag: "friend:" + me.cookbookId, kind: "friendYes"
          });
        });
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
    pushLater(ctx, function () {
      return pushToCookbooks(env, [them.cookbook_id], null, {
        title: "Friend request",
        body: me.username + " would like to link cookbooks with you.",
        url: "/?n=friends", tag: "friend:" + me.cookbookId, kind: "friendAsk"
      });
    });
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
    if (action === "accepted") {
      await resolvePendingPins(env, me.cookbookId, them.cookbook_id);
      /* Only the yes travels. A no is a quiet no. */
      pushLater(ctx, function () {
        return pushToCookbooks(env, [them.cookbook_id], null, {
          title: "Cookbooks linked",
          body: me.username + " accepted your request. Their shared recipes are in your box now.",
          url: "/?n=friends", tag: "friend:" + me.cookbookId, kind: "friendYes"
        });
      });
    }
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

/* The wordmark, tagline and all. Shown on the loading screen, the
   welcome page and at the head of the library, so the app names itself
   the same way in all three places. Kept as one embedded asset for the
   same reason the icon is: the worker has no static file store, and a
   second request for a logo is a second chance for the shell to paint
   without one. */
const LOGO_PNG_B64 = "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";

/* The four woff2 files, base64 in the bundle for the same reason the icon
   is: the worker has no static file store to put them in. Handed out under
   their own paths so a browser caches them for a year and the HTML stays
   the size it was - inlining them into the stylesheet would have put 100kB
   of font on every single page load. */
const FONT_B64 = {
  "fraunces-500": "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",
  "fraunces-700": "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",
  "alegreya-sans-500": "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",
  "alegreya-sans-700": "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"
};
function fontResponse(name) {
  const b64 = FONT_B64[name];
  if (!b64) return null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: {
      "Content-Type": "font/woff2",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function pngResponse(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" }
  });
}
function iconResponse() { return pngResponse(ICON_PNG_B64); }
function logoResponse() { return pngResponse(LOGO_PNG_B64); }

const MANIFEST = JSON.stringify({
  name: "Kindred Cupboard",
  short_name: "Kindred Cupboard",
  start_url: "/",
  scope: "/",
  /* display_override is the standards-based way to ask for the screen with no
     system chrome at all; display stays as the fallback for anything that
     does not read it. Note this is also what Android acts on - there it will
     hide the status bar outright, clock and battery included. Drop the
     override line if that is not what you want on other devices. */
  display_override: ["fullscreen", "standalone"],
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  icons: [{ src: "/icon-v2.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }]
});

/* The whole of the service worker. It exists only to receive pushes and to
   open the right page when one is tapped - there is deliberately no fetch
   handler and no cache, because a worker that serves the app from a cache is
   a worker that can hand somebody last week's app and no way to tell. */
const SW_JS = `/* Kindred Cupboard - notifications only. */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (event) {
  var msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch (err) { msg = {}; }
  /* iOS withdraws permission from a worker that takes a push and shows
     nothing, so there is always a notification, even for an empty one. */
  event.waitUntil(self.registration.showNotification(msg.title || "Kindred Cupboard", {
    body: msg.body || "",
    icon: "/icon.png",
    badge: "/icon.png",
    tag: msg.tag || "kindred",
    renotify: true,
    data: { url: msg.url || "/" }
  }));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(function (list) {
      /* An app already open is steered rather than opened a second time. */
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url && c.url.indexOf(self.registration.scope) === 0) {
          if (c.navigate) return c.navigate(url).then(function (w) { return (w || c).focus(); });
          if (c.focus) return c.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
    }));
});
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /* The bytes behind these paths changed but the paths did not, so browsers
       went on serving a week-old cached copy and an installed app went on
       showing the icon it was installed with. Both are answered under a
       versioned name now: bump the token in APP_HTML, the manifest and here
       together whenever an asset is replaced, and every cache misses at once
       because it is a different URL rather than the same URL with different
       contents. The bare names stay answerable for anything already pointing
       at them. */
    if (/^\/icon(-v\d+)?\.png$/.test(url.pathname)) return iconResponse();
    if (/^\/logo(-v\d+)?\.png$/.test(url.pathname)) return logoResponse();
    /* Anything under /fonts/ is answered here or not at all. Falling through
       handed a missing face the app's own HTML with a 200 on it, which a
       browser then tried to parse as a font. */
    if (url.pathname.startsWith("/fonts/") && url.pathname.endsWith(".woff2")) {
      return fontResponse(url.pathname.slice(7, -6)) || new Response("Not found", { status: 404 });
    }

    /* Served from the root so its scope covers the whole app. Never cached
       for long: a stale worker is how push quietly stops arriving. */
    if (url.pathname === "/sw.js") {
      return new Response(SW_JS, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
          "Service-Worker-Allowed": "/"
        }
      });
    }

    if (url.pathname === "/manifest.webmanifest") {
      return new Response(MANIFEST, {
        /* Short, because the manifest is what names the icon. Held for a day,
           a device kept pointing at the previous icon for a day after the
           icon had already been replaced. The file is tiny; the revalidation
           costs less than the staleness did. */
        headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" }
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
        return await handleApi(url.pathname.slice(5), body || {}, env, request, ctx);
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
