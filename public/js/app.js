(function(){
    // ====================================================================
    // --- MEVCUT TOP15 SİSTEMİ ---
    // ====================================================================

    let db = [];
    const aylar = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"];
    let selectionInProgress = false;
    let lastRequestTime = 0;

    const yS = document.getElementById("yS"), mS = document.getElementById("mS"), wS = document.getElementById("wS");
    const errorBox = document.getElementById("errorBox");

    const showError = (msg) => {
        errorBox.textContent = msg;
        errorBox.style.display = "block";
        setTimeout(() => { errorBox.style.display = "none"; }, 6000);
    };

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

    function renderFilters() {
        const currentYear = yS.value;
        yS.innerHTML = `<option value="">Yıl</option>`;
        const years = [...new Set(db.map(x => x.y))].sort((a,b) => b-a);
        years.forEach(y => { yS.innerHTML += `<option value="${y}">${y}</option>`; });
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
                }, 200);
            }, 200);
        }
    }

    async function init(){
        const cachedMenu = localStorage.getItem('archive_menu');
        if(cachedMenu) {
            try {
                db = JSON.parse(cachedMenu);
                renderFilters();
                selectLatest();
            } catch(e) { localStorage.removeItem('archive_menu'); }
        }
        
        const response = await fetch('/api/archive/weeks');
        const data = await response.json();
        const error = response.ok ? null : data;
        
        if(error) {
            console.error("Supabase Error:", error);
            if(!db.length) showError("Sunucuya ulaşılamıyor. Lütfen sayfayı yenileyin.");
            return;
        }

        const map = new Map();
        data.forEach(w => {
            const key = w.week_start + "|" + w.week_end;
            if(!map.has(key)){
                const d = new Date(w.week_start);
                map.set(key, { s: w.week_start, y: d.getFullYear(), m: d.getMonth(), label: `${formatDate(w.week_start)} - ${formatDate(w.week_end)}` });
            }
        });

        const newDb = Array.from(map.values());
        const rawCache = localStorage.getItem('archive_menu') || "[]";
        
        if(JSON.stringify(newDb) !== JSON.stringify(JSON.parse(rawCache))) {
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
        if(!yS.value){ mS.disabled = true; return; }
        
        [...new Set(db.filter(d => d.y == yS.value).map(d => d.m))].sort((a,b)=>b-a).forEach(m => {
            mS.innerHTML += `<option value="${m}">${aylar[m]}</option>`;
        });
        mS.disabled = false;
    };

    mS.onchange = () => {
        wS.innerHTML = `<option value="">Hafta</option>`;
        document.getElementById("dataArea").style.display = "none";
        if(mS.value === ""){ wS.disabled = true; return; }
        
        db.filter(d => d.y == yS.value && d.m == mS.value).forEach(w => {
            wS.innerHTML += `<option value="${w.s}">${w.label}</option>`;
        });
        wS.disabled = false;
    };

    wS.onchange = async () => {
        if(!wS.value) return;
        const now = Date.now();
        if(now - lastRequestTime < 1000) return;
        lastRequestTime = now;

        const cacheKey = 'week_data_' + wS.value;
        const cachedData = localStorage.getItem(cacheKey);
        if(cachedData) {
            try { render(JSON.parse(cachedData)); } catch(e) {}
        }

        const response = await fetch(`/api/archive/week/${encodeURIComponent(wS.value)}`);
        const data = await response.json();
        const error = response.ok ? null : data;
        
        if(error) {
            showError("Veriler alınamadı, sunucu yoğun olabilir.");
            return;
        }

        if(data && data.length > 0) {
            localStorage.setItem(cacheKey, JSON.stringify(data));
            render(data);
        } else {
            showError("Bu tarihe ait arşiv kaydı bulunamadı.");
        }
    };

    window.markRow = function(row) {
        document.querySelectorAll('tr').forEach(r => r.classList.remove('selected-row'));
        row.classList.add('selected-row');
    }

    function render(data){
        const sorted = [...data].sort((a,b) => (Number(a.sira) || 99) - (Number(b.sira) || 99));
        if(sorted.length === 0) return;

        const list = [sorted[1], sorted[0], sorted[2]];
        let phtml = "";
        
        ["second", "first", "third"].forEach((cls, i) => {
            const d = list[i];
            if(!d){ phtml += `<div class="podium-card hidden-element"></div>`; return; }
            phtml += `<div class="podium-card ${cls}"><div class="podium-rank">#${d.sira}</div><div class="podium-nick">${safe(d.nick)}</div><div class="podium-kills">${d.oldurme} Öldürme</div></div>`;
        });

        document.getElementById("podium").innerHTML = phtml;
        
        document.getElementById("tbody").innerHTML = sorted.map(p => {
            let rankHtml = `#${p.sira}`;
            let colorClass = "sira-other";
            
            if (p.sira == 1) { rankHtml = `👑 #${p.sira}`; colorClass = "sira-1"; }
            else if (p.sira == 2) { rankHtml = `🥈 #${p.sira}`; colorClass = "sira-2"; }
            else if (p.sira == 3) { rankHtml = `🥉 #${p.sira}`; colorClass = "sira-3"; }

            return `
            <tr class="${p.sira <= 3 ? 'highlight' : ''}" onclick="markRow(this)">
                <td class="${colorClass} td-rank">${rankHtml}</td>
                <td class="td-nick">${safe(p.nick)}</td>
                <td>${p.oldurme || 0}</td>
                <td>${p.headshot || "0 (0%)"}</td>
                <td>${p.olumler || "0 (0%)"}</td>
                <td>${p.mermiler || 0}</td>
                <td>${p.hedef_tutturma || "0 (0%)"}</td>
            </tr>`;
        }).join("");
        
        if(!document.getElementById("tabChampions").classList.contains("active-tab")) {
            document.getElementById("dataArea").style.display = "block";
        }
    }

    init();

    // ====================================================================
    // --- ŞAMPİYONLAR SALONU ---
    // ====================================================================
    
    const tabTop15 = document.getElementById("tabTop15");
    const tabChampions = document.getElementById("tabChampions");
    const championsArea = document.getElementById("championsArea");
    const dataArea = document.getElementById("dataArea");
    const champSearch = document.getElementById("champSearch");
    const championsListElement = document.getElementById("championsList");
    const champLoading = document.getElementById("champLoading");
    const champNoResult = document.getElementById("champNoResult");
    const champEmpty = document.getElementById("champEmpty");
    const filtersArea = document.querySelector(".filters");
    
    let rawChampionsData = [];

    // Görünüm Değiştiriciler
    tabTop15.addEventListener("click", () => {
        tabTop15.classList.add("active-tab");
        tabChampions.classList.remove("active-tab");
        
        championsArea.style.display = "none";
        filtersArea.style.display = "flex";
        
        champSearch.value = "";
        champNoResult.style.display = "none";
        champEmpty.style.display = "none";
        
        if (wS.value && document.getElementById("tbody").innerHTML.trim() !== "") {
            dataArea.style.display = "block";
        }
    });

    tabChampions.addEventListener("click", () => {
        tabChampions.classList.add("active-tab");
        tabTop15.classList.remove("active-tab");
        
        dataArea.style.display = "none";
        filtersArea.style.display = "none";
        championsArea.style.display = "block";
        
        champSearch.value = "";
        champNoResult.style.display = "none";
        
        loadChampions();
    });

    // Stale-while-revalidate Cache Mantığı
    async function loadChampions() {
        const cacheKey = 'champions_cache_v2';
        const cached = localStorage.getItem(cacheKey);
        let hasCache = false;
        
        // 1. AŞAMA: CACHE VARSA ANINDA GÖSTER
        if(cached) {
            try {
                const parsedData = JSON.parse(cached);
                if (parsedData && parsedData.data && parsedData.data.length > 0) {
                    rawChampionsData = parsedData.data;
                    renderChampionsList(); 
                    hasCache = true;
                }
            } catch(e) {
                localStorage.removeItem(cacheKey);
            }
        }

        // Cache yoksa yükleniyor ekranını aç
        if (!hasCache) {
            champLoading.style.display = "block";
            championsListElement.innerHTML = "";
            championsListElement.style.display = "none";
            champNoResult.style.display = "none";
            champEmpty.style.display = "none";
        }

        // 2. AŞAMA: ARKA PLANDA SUPABASE'DEN GÜNCEL VERİ ÇEK (Revalidate)
        const response = await fetch('/api/archive/champions');
        const data = await response.json();
        const error = response.ok ? null : data;
            
        if(error) {
            if (!hasCache) {
                champLoading.style.display = "none";
                showError("Şampiyonlar yüklenirken sunucu ile iletişim kurulamadı.");
            }
            return;
        }

        // 3. AŞAMA: VERİ KONTROLÜ VE EKRANI SESSİZCE YENİLEME
        if(data && data.length > 0) {
            champEmpty.style.display = "none";
            const isDataChanged = JSON.stringify(data) !== JSON.stringify(rawChampionsData);
            
            // Veri değiştiyse veya daha önce hiç cache yoksa UI'ı güncelle
            if (isDataChanged || !hasCache) {
                rawChampionsData = data;
                localStorage.setItem(cacheKey, JSON.stringify({ data: rawChampionsData, timestamp: Date.now() }));
                renderChampionsList();
            }
        } else {
            // Supabase boş dönerse tüm listeleri kapat ve mesaj göster
            champLoading.style.display = "none";
            championsListElement.style.display = "none";
            champEmpty.style.display = "block";
            localStorage.removeItem(cacheKey);
            rawChampionsData = [];
        }
    }

    // Şampiyon Verilerini İşleme ve Ekrana Basma
    function renderChampionsList() {
        if(!rawChampionsData || rawChampionsData.length === 0) {
            champLoading.style.display = "none";
            return;
        }

        const groupedPlayers = {};
        let totalChampionshipWeeks = 0;

        rawChampionsData.forEach(row => {
            const nick = row.nick || "Bilinmeyen Şampiyon";
            if(!groupedPlayers[nick]) {
                groupedPlayers[nick] = { nick: nick, count: 0, weeks: [], latestDate: "" };
            }
            groupedPlayers[nick].count += 1;
            groupedPlayers[nick].weeks.push({
                start: row.week_start,
                end: row.week_end,
                label: `${formatDate(row.week_start)} - ${formatDate(row.week_end)}`
            });
            totalChampionshipWeeks++;
            
            if(!groupedPlayers[nick].latestDate || row.week_start > groupedPlayers[nick].latestDate) {
                groupedPlayers[nick].latestDate = row.week_start;
            }
        });

        const sortedChampions = Object.values(groupedPlayers).sort((a, b) => {
            if(b.count !== a.count) return b.count - a.count;
            return b.latestDate.localeCompare(a.latestDate); 
        });

        // Özet İstatistikleri Güncelle
        document.getElementById("sumWeeks").textContent = totalChampionshipWeeks;
        document.getElementById("sumPlayers").textContent = sortedChampions.length;
        
        if(sortedChampions.length > 0) {
            const king = sortedChampions[0];
            /* SADECE METİN DEĞİŞİKLİĞİ: 'Şampiyonluk' YERİNE 'Kez Şampiyon' EKLENDİ */
            document.getElementById("sumKing").innerHTML = `${safe(king.nick)}<br><span class="champ-king-subtitle">🏆 ${king.count} Kez Şampiyon</span>`;
        } else {
            document.getElementById("sumKing").textContent = "-";
        }

        // Accordion Kartları Oluştur
        championsListElement.innerHTML = sortedChampions.map((champ, index) => {
            const sortedWeeks = champ.weeks.sort((a, b) => b.start.localeCompare(a.start));
            const kingIcon = index === 0 ? '<span class="champ-king-icon">👑</span>' : '';
            
            return `
            <div class="champ-card">
                <div class="champ-header">
                    <div class="champ-name">${kingIcon}<span class="champ-real-name">${safe(champ.nick)}</span></div>
                    <div class="champ-header-right">
                        <span class="champ-count">🏆 ${champ.count} Şampiyonluk</span>
                        <span class="arrow-icon">▼</span>
                    </div>
                </div>
                <div class="champ-body">
                    <div class="champ-week-title">▼ Şampiyon Olduğu Haftalar</div>
                    ${sortedWeeks.map(w => `<div class="champ-week-item">${w.label}</div>`).join("")}
                </div>
            </div>`;
        }).join("");

        // Yükleniyor'u gizle, listeyi göster
        champLoading.style.display = "none";
        champEmpty.style.display = "none";
        championsListElement.style.display = "flex";
        
        champSearch.value = "";
        champNoResult.style.display = "none";
    }

    // Accordion Açma/Kapama İşlemi
    championsListElement.addEventListener('click', function(e) {
        const header = e.target.closest('.champ-header');
        if (header) {
            header.parentElement.classList.toggle('open');
        }
    });

    // Türkçe Karakter Normalizasyon Fonksiyonu
    const normalizeTurkish = (str) => {
        return str.replace(/İ/g, 'i')
                  .replace(/I/g, 'ı')
                  .toLowerCase()
                  .replace(/ç/g, 'c')
                  .replace(/ğ/g, 'g')
                  .replace(/ö/g, 'o')
                  .replace(/ş/g, 's')
                  .replace(/ü/g, 'u')
                  .replace(/ı/g, 'i');
    };

    // Oyuncu Arama Filtresi
    champSearch.addEventListener("input", (e) => {
        const searchValue = normalizeTurkish(e.target.value);
        const championCards = document.querySelectorAll(".champ-card");
        let visibleCount = 0;
        
        championCards.forEach(card => {
            card.classList.remove('open');
            const playerNameNode = card.querySelector(".champ-real-name");
            if (playerNameNode) {
                const playerName = normalizeTurkish(playerNameNode.textContent);
                if(playerName.includes(searchValue)) {
                    card.style.display = "block";
                    visibleCount++;
                } else {
                    card.style.display = "none";
                }
            }
        });

        if (visibleCount === 0 && championCards.length > 0) {
            champNoResult.style.display = "block";
        } else {
            champNoResult.style.display = "none";
        }
    });
})();
