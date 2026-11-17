
(() => {
 "use strict";

 const app = window.NFT_CASE;

 if (!app) {
  console.error("NFT_CASE не найден");
  return;
 }

 const Upgrade = {
  inventory: [],
  catalog: [],
  multipliers: {},
  mode: "multiplier",
  multiplier: 2,

  escape(value) {
   return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
   }[char]));
  },

  backgroundName(value) {
   return ({
    normal: "Normal",
    gold: "Gold",
    onyx_black: "Onyx Black",
    black: "Black"
   })[value] || "Normal";
  },

  async load() {
   try {
    const data = await app.request("/api/upgrade/options");

    this.inventory = data.inventory || [];
    this.catalog = data.catalog || [];
    this.multipliers = data.multipliers || {};

    this.renderSource();
    this.renderTargets();
    this.updateInfo();
   } catch (error) {
    console.error("Ошибка загрузки апгрейда:", error);
    app.notice(error.message || "Не удалось загрузить апгрейд");
   }
  },

  renderSource() {
   const select = document.getElementById("upgradeSource");
   const previous = select.value;

   if (!this.inventory.length) {
    select.innerHTML = '<option value="">Инвентарь пуст</option>';
    return;
   }

   select.innerHTML =
    '<option value="">Выбери NFT</option>' +
    this.inventory.map(item => `
     <option value="${Number(item.inventory_id)}">
      ${this.escape(item.name || item.code)} — ${app.format(item.final_price)}
      (${this.backgroundName(item.background)})
     </option>
    `).join("");

   if (previous && this.inventory.some(x =>
    String(x.inventory_id) === previous
   )) {
    select.value = previous;
   }
  },

  getSource() {
   const id = Number(document.getElementById("upgradeSource").value);

   return this.inventory.find(item =>
    Number(item.inventory_id) === id
   ) || null;
  },

  getBackgroundMultiplier(background) {
   return ({
    normal: 1,
    gold: 3,
    onyx_black: 5,
    black: 10
   })[background] || 1;
  },

  getTargetBackground() {
   return document.getElementById("upgradeBackground").value;
  },

  getTargetPrice() {
   const source = this.getSource();

   if (!source) return 0;

   const sourcePrice = Number(source.final_price || 0);
   const targetBackground = this.getBackgroundMultiplier(
    this.getTargetBackground()
   );

   if (this.mode === "multiplier") {
    return sourcePrice * this.multiplier / targetBackground;
   }

   const chance = Math.min(
    50,
    Math.max(1, Number(document.getElementById("upgradeChance").value) || 1)
   );

   return sourcePrice / (chance / 100) / targetBackground;
  },

  renderTargets() {
   const select = document.getElementById("upgradeTarget");
   const source = this.getSource();

   if (!source) {
    select.innerHTML =
     '<option value="">Сначала выбери исходный NFT</option>';
    return;
   }

   const desiredPrice = this.getTargetPrice();

   const candidates = this.catalog
    .filter(item => Number(item.base_price) > 0)
    .map(item => ({
     ...item,
     distance: Math.abs(
      Number(item.base_price) - desiredPrice
     )
    }))
    .sort((a, b) => a.distance - b.distance);

   if (!candidates.length) {
    select.innerHTML =
     '<option value="">Каталог NFT пуст</option>';
    return;
   }

   const previous = select.value;

   select.innerHTML =
    '<option value="">Выбери желаемый NFT</option>' +
    candidates.map(item => `
     <option value="${Number(item.id)}">
      ${this.escape(item.name || item.code)} — ${app.format(item.base_price)}
     </option>
    `).join("");

   if (previous && candidates.some(x => String(x.id) === previous)) {
    select.value = previous;
   }
  },

  updateInfo() {
   const source = this.getSource();
   const info = document.getElementById("upgradeInfo");

   if (!source) {
    info.textContent = "Выбери NFT для начала";
    return;
   }

   const sourcePrice = Number(source.final_price || 0);
   const desiredPrice = this.getTargetPrice();

   let chance;

   if (this.mode === "multiplier") {
    chance = Number(this.multipliers[this.multiplier]);

    if (!Number.isFinite(chance)) {
     chance = 100 / this.multiplier;
    }

    if (chance > 1) chance /= 100;
   } else {
    chance = Math.min(
     50,
     Math.max(1, Number(document.getElementById("upgradeChance").value) || 1)
    ) / 100;
   }

   const selectedId = Number(
    document.getElementById("upgradeTarget").value
   );

   const target = this.catalog.find(x => Number(x.id) === selectedId);

   info.innerHTML = `
    <div style="display:grid;gap:7px">
     <div class="row">
      <span>Стоимость твоего NFT</span>
      <strong>${app.format(sourcePrice)}</strong>
     </div>
     <div class="row">
      <span>Примерная стоимость цели</span>
      <strong>${app.format(desiredPrice)}</strong>
     </div>
     <div class="row">
      <span>Шанс по выбранному режиму</span>
      <strong style="color:#bbaaff">${(chance * 100).toFixed(2)}%</strong>
     </div>
     ${target ? `
      <div class="row">
       <span>Выбранная цель</span>
       <strong>${this.escape(target.name || target.code)}</strong>
      </div>
     ` : ""}
    </div>
    <div style="margin-top:10px;font-size:11px;color:#858b9c">
     Итоговая вероятность и допустимость цены проверяются сервером.
    </div>
   `;
  },

  async play() {
   const source = this.getSource();

   if (!source) {
    app.notice("Сначала выбери свой NFT");
    return;
   }

   const targetId = Number(
    document.getElementById("upgradeTarget").value
   );

   if (!targetId) {
    app.notice("Выбери NFT, который хочешь получить");
    return;
   }

   const background = this.getTargetBackground();

   const body = {
    inventory_id: Number(source.inventory_id),
    target_nft_id: targetId,
    target_background: background,
    mode: this.mode
   };

   if (this.mode === "multiplier") {
    body.multiplier = this.multiplier;
   } else {
    body.chance = Math.min(
     50,
     Math.max(1, Number(document.getElementById("upgradeChance").value) || 1)
    );
   }

   const button = document.getElementById("upgradeButton");
   button.disabled = true;
   button.textContent = "АПГРЕЙД...";

   try {
    const result = await app.request("/api/upgrade", {
     method: "POST",
     body: JSON.stringify(body)
    });

    if (result.won) {
     app.showModal(`
      <div style="clear:both;text-align:center;padding-top:15px">
       <div style="font-size:65px">🎉</div>
       <h2 style="color:#48d69a;margin:10px 0">АПГРЕЙД УДАЛСЯ!</h2>
       <p style="margin:10px 0">${this.escape(result.message || "Ты получил новый NFT!")}</p>
       ${result.reward ? `
        <div class="result-item">
         <strong>${this.escape(result.reward.name || "NFT")}</strong>
         <div class="muted small">${app.format(result.reward.final_price)}</div>
        </div>
       ` : ""}
       <button class="primary" id="upgradeResultClose">Продолжить</button>
      </div>
     `);
    } else {
     app.showModal(`
      <div style="clear:both;text-align:center;padding-top:15px">
       <div style="font-size:65px">💔</div>
       <h2 style="color:#ff8294;margin:10px 0">НЕ ПОВЕЗЛО</h2>
       <p class="muted" style="margin:10px 0">
        ${this.escape(result.message || "Исходный NFT сгорел")}
       </p>
       <button class="primary" id="upgradeResultClose">Понятно</button>
      </div>
     `);
    }

    document.getElementById("upgradeResultClose").onclick = () => {
     app.closeModal();
    };

    await this.load();
    await window.Profile?.load();
    await window.Craft?.load();

   } catch (error) {
    app.notice(error.message || "Ошибка апгрейда");
   } finally {
    button.disabled = false;
    button.textContent = "ПРОКАЧАТЬ NFT";
   }
  },

  init() {
   document.getElementById("upgradeModes")
    .querySelectorAll("button").forEach(button => {
     button.onclick = () => {
      this.mode = button.dataset.mode;

      document.querySelectorAll("#upgradeModes button")
       .forEach(x => x.classList.toggle("selected", x === button));

      document.getElementById("multiplierTabs").style.display =
       this.mode === "multiplier" ? "flex" : "none";

      document.getElementById("chanceControls").style.display =
       this.mode === "chance" ? "block" : "none";

      this.renderTargets();
      this.updateInfo();
     };
    });

   document.getElementById("multiplierTabs")
    .querySelectorAll("button").forEach(button => {
     button.onclick = () => {
      this.multiplier = Number(button.dataset.multiplier);

      document.querySelectorAll("#multiplierTabs button")
       .forEach(x => x.classList.toggle("selected", x === button));

      this.renderTargets();
      this.updateInfo();
     };
    });

   document.getElementById("upgradeSource").onchange = () => {
    this.renderTargets();
    this.updateInfo();
   };

   document.getElementById("upgradeBackground").onchange = () => {
    this.renderTargets();
    this.updateInfo();
   };

   document.getElementById("upgradeChance").oninput = () => {
    this.renderTargets();
    this.updateInfo();
   };

   document.getElementById("upgradeTarget").onchange = () => {
    this.updateInfo();
   };

   document.getElementById("upgradeButton").onclick = () => {
    this.play();
   };
  }
 };

 window.Upgrade = Upgrade;
 Upgrade.init();
})();
