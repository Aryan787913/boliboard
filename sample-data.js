/*
 * SAMPLE DATA. Every brand, founder, code and amount below is fictional.
 * Shown only when the live database isn't configured, or is still empty before launch.
 */
window.BOLI_SAMPLE = (function () {
  "use strict";
  // key: [brand, founder, city, category, one-line story, offer, code, clicks]
  var B = {
    kesar: ["Kesar Kosh", "Ananya Rao", "Mumbai", "Skincare & Beauty", "Saffron serums from her grandmother's kitchen notes.", "15% off", "KESAR15", 4812],
    chatpata: ["Chatpata Lab", "Rohan Mehta", "Bengaluru", "Snacks & Food", "Baked chakli that started at a weekend flea market.", "10% off", "CHATPATA10", 3260],
    loom: ["Loomwali", "Meera Sethi", "Jaipur", "Fashion", "Block-printed cotton from 40 artisan families.", "20% off", "LOOM20", 2975],
    glow: ["Haldi Glow", "Riya Malhotra", "Delhi NCR", "Skincare & Beauty", "Turmeric-first skincare for humid summers.", "20% off", "GLOW20", 2410],
    mitti: ["Mitti Ghar", "Kabir Shah", "Pune", "Home", "Terracotta planters, fired in small batches.", "12% off", "MITTI12", 1988],
    neel: ["Neel Dhaga", "Vikram Joshi", "Mumbai", "Fashion", "Natural-indigo kurtas, dyed by hand.", "15% off", "NEEL15", 1604],
    dum: ["Dumdaar Fit", "Arjun Nair", "Hyderabad", "Health & Fitness", "Millet protein bars made for Indian gyms.", "15% off", "DUM15", 1377],
    phool: ["Phool Makhana Co.", "Sana Qureshi", "Delhi NCR", "Snacks & Food", "Roasted fox nuts in six Indian flavours.", "10% off", "PHOOL10", 1290],
    hisaab: ["Hisaab Labs", "Priya Iyer", "Bengaluru", "Startups", "A billing app for neighbourhood stores.", "30% off first year", "HISAAB30", 1102],
    sukoon: ["Sukoon Home", "Farhan Ali", "Mumbai", "Home", "Cotton bedsheets that soften with every wash.", "10% off", "SUKOON10", 846],
    ship: ["Shipwise", "Aditya Verma", "Mumbai", "Startups", "Same-day shipping for small D2C sellers.", "20% off", "SHIP20", 690],
    saans: ["Saans Wellness", "Neha Kulkarni", "Pune", "Health & Fitness", "Breathwork classes, ten minutes a day.", "25% off", "SAANS25", 455],
    pahadi: ["Pahadi Pantry", "Tenzin Dorje", "Other", "Snacks & Food", "Himalayan pink-salt chips from small farms.", "10% off", "PAHADI10", 318]
  };
  var boards = {
    all: [["kesar", 48500], ["chatpata", 31200], ["loom", 22750], ["glow", 18400], ["mitti", 15900], ["neel", 12300], ["dum", 9999], ["phool", 8800], ["hisaab", 7450], ["sukoon", 5200], ["ship", 4200], ["saans", 2999], ["pahadi", 1499]],
    today: [["chatpata", 6400], ["phool", 6300], ["kesar", 4800], ["glow", 4450], ["loom", 3900], ["sukoon", 3100], ["mitti", 2650], ["dum", 1999], ["neel", 1750], ["hisaab", 1450], ["ship", 899], ["saans", 499], ["pahadi", 299]],
    daily: [
      [["kesar", 3900], ["loom", 3500], ["dum", 2800], ["chatpata", 2200], ["neel", 1950], ["glow", 1750], ["mitti", 1200], ["hisaab", 950], ["sukoon", 800], ["phool", 650], ["saans", 499], ["ship", 399], ["pahadi", 199]],
      [["chatpata", 4100], ["kesar", 3600], ["glow", 2900], ["phool", 2350], ["loom", 1800], ["mitti", 1500], ["neel", 1100], ["sukoon", 900], ["dum", 700], ["hisaab", 450], ["pahadi", 299], ["ship", 199]],
      [["loom", 2700], ["kesar", 2600], ["neel", 1900], ["glow", 1400], ["chatpata", 1250], ["dum", 999], ["saans", 650], ["mitti", 500], ["sukoon", 399], ["phool", 199]]
    ]
  };
  function row(k, total) {
    var b = B[k];
    return { id: "sample-" + k, name: b[0], founder_name: b[1], city: b[2], category: b[3], story: b[4], offer: b[5], discount_code: b[6], clicks: b[7], total: total, url: "#", sample: true };
  }
  var activity = [
    { name: "Chatpata Lab", amount: 100, board: "today", minsAgo: 4 },
    { name: "Haldi Glow", amount: 350, board: "all", minsAgo: 17 },
    { name: "Sukoon Home", amount: 600, board: "today", minsAgo: 31 },
    { name: "Dumdaar Fit", amount: 1200, board: "all", minsAgo: 62 },
    { name: "Loomwali", amount: 199, board: "today", minsAgo: 80 }
  ];
  return {
    board: function (name, dayIndex) {
      var src = name === "daily" ? boards.daily[dayIndex || 0] || [] : boards[name] || [];
      return src.map(function (r) { return row(r[0], r[1]); });
    },
    dailyCount: boards.daily.length,
    activity: activity
  };
})();
