/* Tesla storefront reference data. Shared by the browser (window.EV) and the server (require).
   Applesmart is an independent marketplace and is not affiliated with Tesla, Inc. */
(function (root) {
  "use strict";
  const MODELS = {
    model3:     { n: "Model 3",    from: 2017, body: "sedan",  trims: ["RWD", "Long Range AWD", "Long Range RWD", "Performance", "Standard Range Plus", "Mid Range", "Long Range"] },
    modely:     { n: "Model Y",    from: 2020, body: "suv",    trims: ["RWD", "Long Range AWD", "Long Range RWD", "Performance", "Standard Range"] },
    models:     { n: "Model S",    from: 2012, body: "sedan",  trims: ["Dual Motor AWD", "Plaid", "Long Range", "100D", "P100D", "90D", "75D", "85", "P85D"] },
    modelx:     { n: "Model X",    from: 2015, body: "suv",    trims: ["Dual Motor AWD", "Plaid", "Long Range", "100D", "P100D", "90D", "75D"] },
    cybertruck: { n: "Cybertruck", from: 2024, body: "truck",  trims: ["All-Wheel Drive", "Cyberbeast", "Long Range RWD", "Foundation Series AWD", "Foundation Series Cyberbeast"] },
  };
  const CATS = [
    { k: "model3", n: "Model 3", p: "Model 3s", vehicle: true },
    { k: "modely", n: "Model Y", p: "Model Ys", vehicle: true },
    { k: "models", n: "Model S", p: "Model Ss", vehicle: true },
    { k: "modelx", n: "Model X", p: "Model Xs", vehicle: true },
    { k: "cybertruck", n: "Cybertruck", p: "Cybertrucks", vehicle: true },
    { k: "charging", n: "Charging", p: "Charging gear" },
    { k: "wheels", n: "Wheels & Tires", p: "Wheels and tires" },
    { k: "teslaparts", n: "Accessories", p: "Tesla accessories" },
  ];
  const PRODUCTS = {
    charging: ["Wall Connector (Gen 3)", "Universal Wall Connector", "Mobile Connector", "NEMA 14-50 adapter", "J1772 adapter", "CCS1 combo adapter"],
    wheels: ['18" Aero wheels', '19" Gemini wheels', '20" Induction wheels', '21" Arachnid wheels', "Winter wheel and tire package", "Set of 4 tires"],
    teslaparts: ["All-weather floor mats", "Roof rack", "Tow hitch", "Center console organizer", "Screen protector", "Sunshade"],
  };
  const AUTOPILOT = { none: "No Autopilot", ap: "Autopilot", eap: "Enhanced Autopilot", fsd: "Full Self-Driving" };
  const TITLE = { clean: "Clean", lien: "Clean, loan on it", rebuilt: "Rebuilt", salvage: "Salvage" };
  const ACCIDENTS = { none: "No accidents", minor: "Minor", major: "Major" };
  const CHECKS = {
    vehicle: [["warranty", "Battery & drive unit warranty remaining"], ["supercharging", "Free Supercharging transfers"], ["service", "Service records available"], ["tires", "Tires have half their tread or more"]],
    accessory: [["genuine", "Genuine Tesla part"], ["boxed", "Original box and packaging"]],
  };
  const GRADES = {
    A: { n: "Grade A", t: "Excellent", d: "Like new. No curb rash, chips or interior wear." },
    B: { n: "Grade B", t: "Good", d: "Light wear: small stone chips or minor scuffs." },
    C: { n: "Grade C", t: "Fair", d: "Visible cosmetic wear or damage, but mechanically sound." },
  };
  const MAX_YEAR = 2027;
  const isVehicle = (cat) => !!MODELS[cat];
  const EV = { MODELS, CATS, PRODUCTS, AUTOPILOT, TITLE, ACCIDENTS, CHECKS, GRADES, MAX_YEAR, isVehicle };
  if (typeof module !== "undefined" && module.exports) module.exports = EV; else root.EV = EV;
})(typeof self !== "undefined" ? self : this);
