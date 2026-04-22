<script>
(function(){

    const SUPABASE_URL = "https://cyeklyjeszniowopawpc.supabase.co";
    const SUPABASE_KEY = "sb_publishable_RUhk34F8aZiNcgIDIZAwCA_8ZATrGh0";

    const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    let db = [];
    const aylar = ["OCAK","ŞUBAT","MART","NİSAN","MAYIS","HAZİRAN","TEMMUZ","AĞUSTOS","EYLÜL","EKİM","KASIM","ARALIK"];
    let selectionInProgress = false;

    let lastFetchTime = 0;
    const FETCH_COOLDOWN = 1500;

    const yS = document.getElementById("yS"), mS = document.getElementById("mS"), wS = document.getElementById("wS");

    const safe = (s) => {
        const div = document.createElement("div");
        div.textContent = s || "";
        return div.innerHTML;
    };

    const formatDate = (dateStr) => {
        if(!dateStr) return "";
        const [y, m, d] = dateStr.split("-");
        return `${d}.${m}.${y}`;
    };

    function canFetch(){
        const now = Date.now();
        if(now - lastFetchTime < FETCH_COOLDOWN){
            console.warn("⛔ Çok hızlı istek!");
            return false;
        }
        lastFetchTime = now;
        return true;
    }

    function renderFilters() {
        const currentYear = yS.value;
        yS.innerHTML = `<option value="">Yıl</option>`;
        [...new Set(db.map(x => x.y))].forEach(y => {
            yS.innerHTML += `<option value="${y}">${y}</option>`;
        });
        if(currentYear) yS.value = currentYear;
    }

    function selectLatest() {
        if (db.length > 0 && !selectionInProgress) {
            selectionInProgress = true;
            const latest = db[0]; 
            yS.value = latest.y;
            yS.dispatchEvent(new Event('change')); 
            setTimeout(() => {
                mS.value = latest.m;
                mS.dispatchEvent(new Event('change')); 
                setTimeout(() => {
                    wS.value = latest.s;
                    wS.dispatchEvent(new Event('change'));
                    selectionInProgress = false;
                }, 250);
            }, 250);
        }
    }

    async function init(){
        const cachedMenu = localStorage.getItem('archive_menu');
        if(cachedMenu) {
            db = JSON.parse(cachedMenu);
            renderFilters();
            selectLatest();
        }

        if(!canFetch()) return;

        const {data, error} = await client
            .from("weekly_top15")
            .select("week_start,week_end")
            .order("week_end", {ascending: false});

        if(error) return;

        const map = new Map();

        data.forEach(w => {
            const key = w.week_start + "|" + w.week_end;
            if(!map.has(key)){
                const d = new Date(w.week_start);
                map.set(key, {
                    s: w.week_start,
                    y: d.getFullYear(),
                    m: d.getMonth(),
                    label: `${formatDate(w.week_start)} - ${formatDate(w.week_end)}`
                });
            }
        });

        const newDb = Array.from(map.values());

        if(JSON.stringify(newDb) !== cachedMenu) {
            db = newDb;
            localStorage.setItem('archive_menu', JSON.stringify(db));
            renderFilters();
            if(!selectionInProgress) selectLatest();
        }
    }

    yS.onchange = () => {
        mS.innerHTML = `<option value="">Ay</option>`;
        wS.innerHTML = `<option value="">Hafta</option>`;
        wS.disabled = true;
        document.getElementById("dataArea").style.display = "none";

        if(!yS.value){
            mS.disabled = true;
            return;
        }

        [...new Set(db.filter(d => d.y == yS.value).map(d => d.m))]
            .sort((a,b)=>a-b)
            .forEach(m => {
                mS.innerHTML += `<option value="${m}">${aylar[m]}</option>`;
            });

        mS.disabled = false;
    };

    mS.onchange = () => {
        wS.innerHTML = `<option value="">Hafta</option>`;
        document.getElementById("dataArea").style.display = "none";

        if(mS.value === ""){
            wS.disabled = true;
            return;
        }

        db.filter(d => d.y == yS.value && d.m == mS.value).forEach(w => {
            wS.innerHTML += `<option value="${w.s}">${w.label}</option>`;
        });

        wS.disabled = false;
    };

    wS.onchange = async () => {
        if(!wS.value) return;

        if(!canFetch()) return;

        const cacheKey = 'week_data_' + wS.value;
        const cachedData = localStorage.getItem(cacheKey);

        if(cachedData) render(JSON.parse(cachedData));

        const {data, error} = await client
            .from("weekly_top15")
            .select("*")
            .eq("week_start", wS.value)
            .order("rank");

        if(!error) {
            localStorage.setItem(cacheKey, JSON.stringify(data));
            render(data);
        }
    };

    function markRow(row) {
        document.querySelectorAll('tr').forEach(r => r.classList.remove('selected-row'));
        row.classList.add('selected-row');
    }

    function render(data){
        const sorted = [...data].sort((a,b) => (Number(a.rank) || 99) - (Number(b.rank) || 99));
        const list = [sorted[1], sorted[0], sorted[2]];

        let phtml = "";

        ["second", "first", "third"].forEach((cls, i) => {
            const d = list[i];
            if(!d){
                phtml += `<div class="podium-card" style="visibility:hidden"></div>`;
                return;
            }

            phtml += `
                <div class="podium-card ${cls}">
                    <div style="font-size:1.1rem">#${d.rank}</div>
                    <div class="podium-nick">${safe(d.nick)}</div>
                    <div style="font-size:0.9rem">${d.kills} Kills</div>
                </div>`;
        });

        document.getElementById("podium").innerHTML = phtml;

        document.getElementById("tbody").innerHTML = sorted.map(p => `
            <tr class="${p.rank <= 3 ? 'highlight' : ''}" onclick="markRow(this)">
                <td style="font-weight:bold; color:#d4af37">#${p.rank}</td>
                <td style="text-align:left; padding-left:15px;">${safe(p.nick)}</td>
                <td>${p.kills || 0}</td>
                <td>${p.hs_percent || 0}%</td>
                <td>${p.deaths || 0}</td>
                <td>${p.mermiler || 0}</td>
                <td>${p.accuracy || 0}%</td>
            </tr>
        `).join("");

        document.getElementById("dataArea").style.display = "block";
    }

    init();

})();
</script>
