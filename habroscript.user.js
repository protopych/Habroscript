// ==UserScript==
// @name           Habroscript
// @author         protopych
// @version        1.0
// @description    Clear the main page of habr.com from blacklisted authors + UI management
// @match          https://habr.com/*
// @grant          GM_log
// @grant          GM_getValue
// @grant          GM_setValue
// @grant          GM_registerMenuCommand
// @license        MIT
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'habr_blacklist_authors_v1';
    const HIDE_ALL_COMPANIES_KEY = 'habr_hide_all_companies_v1';
    const DEFAULT_BLACKLIST = [];

    // ---------- storage ----------
    function loadBlacklist() {
        let stored = null;
        try { stored = GM_getValue(STORAGE_KEY, null); } catch (e) {}
        if (stored === null || stored === undefined) {
            saveBlacklist(DEFAULT_BLACKLIST);
            return [...DEFAULT_BLACKLIST];
        }
        try {
            const arr = JSON.parse(stored);
            if (Array.isArray(arr)) return arr;
        } catch (e) {}
        return [...DEFAULT_BLACKLIST];
    }
    function saveBlacklist(arr) {
        try { GM_setValue(STORAGE_KEY, JSON.stringify(arr)); }
        catch (e) { console.warn('[Blacklist] save failed', e); }
    }

    function loadHideAllCompanies() {
        let v = null;
        try { v = GM_getValue(HIDE_ALL_COMPANIES_KEY, null); } catch (e) {}
        return v === true || v === 'true';
    }
    function saveHideAllCompanies(v) {
        try { GM_setValue(HIDE_ALL_COMPANIES_KEY, v ? 'true' : 'false'); }
        catch (e) { console.warn('[Blacklist] save failed', e); }
    }

    let blacklist = loadBlacklist();
    let hideAllCompanyArticles = loadHideAllCompanies();

    function isBlacklisted(name) {
        if (!name) return false;
        const lower = name.toLowerCase();
        return blacklist.some(a => a.toLowerCase() === lower);
    }
    function addToBlacklist(name) {
        if (!name || isBlacklisted(name)) return false;
        blacklist.push(name);
        saveBlacklist(blacklist);
        log(`Added: ${name}`);
        return true;
    }
    function removeFromBlacklist(name) {
        const lower = name.toLowerCase();
        const idx = blacklist.findIndex(a => a.toLowerCase() === lower);
        if (idx === -1) return false;
        blacklist.splice(idx, 1);
        saveBlacklist(blacklist);
        log(`Removed: ${name}`);
        return true;
    }
    function log(msg) {
        console.log('[Blacklist]', msg);
        if (typeof GM_log === 'function') { try { GM_log(msg); } catch (e) {} }
    }

    // ---------- page-type guards ----------
    function isUserSubpage() {
        return /^\/ru\/users\/[^\/]+\/(articles|posts|news)\/?$/.test(location.pathname);
    }

    function getCompanyAliasFromUrl() {
        const m = location.pathname.match(
            /^\/ru\/companies\/([^\/]+)\/(?:profile\/|articles\/?$|posts\/?$|news\/?$|workers\/|fans\/)/
        );
        return m ? decodeURIComponent(m[1]) : null;
    }

    function isCompanyPage() {
        return getCompanyAliasFromUrl() !== null;
    }

    // ---------- extraction ----------
    function getAuthorName(article) {
        const usernameEl = article.querySelector('.tm-user-info__username');
        if (usernameEl) {
            const name = usernameEl.textContent.trim();
            if (name) return name;
        }
        const userLink = article.querySelector(
            'a.tm-user-info__userpic[href*="/ru/users/"], a.tm-user-info__username[href*="/ru/users/"]'
        );
        if (userLink) {
            const m = (userLink.getAttribute('href') || '').match(/\/ru\/users\/([^/?#]+)/);
            if (m) return decodeURIComponent(m[1]);
        }
        return null;
    }

    function getCompanyName(article) {
        const link = article.querySelector('a.tm-title__link');
        if (!link) return null;
        const href = link.getAttribute('href') || '';
        const m = href.match(/^\/ru\/companies\/([^/?#]+)\/articles\/\d+\/?/);
        return m ? decodeURIComponent(m[1]) : null;
    }

    // ---------- import / export ----------
    function exportBlacklist() {
        const text = [...blacklist]
            .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
            .join('\n') + '\n';
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'habr-blacklist.txt';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        log(`Exported ${blacklist.length} author(s)`);
    }

    function parseBlacklistFile(text) {
        return Array.from(new Set(
            String(text)
                .split(/\r?\n/)
                .map(s => s.trim())
                .filter(s => s && !s.startsWith('#'))
        ));
    }

    function mergeIntoBlacklist(names) {
        const seen = new Set(blacklist.map(a => a.toLowerCase()));
        let added = 0;
        for (const name of names) {
            const lower = name.toLowerCase();
            if (seen.has(lower)) continue;
            seen.add(lower);
            blacklist.push(name);
            added++;
        }
        if (added > 0) saveBlacklist(blacklist);
        return added;
    }

    function importBlacklistFromFile(file, onDone) {
        const reader = new FileReader();
        reader.onerror = () => {
            alert('Не удалось прочитать файл.');
        };
        reader.onload = () => {
            const names = parseBlacklistFile(reader.result);
            if (!names.length) {
                alert('В файле не найдено ни одного имени.');
                return;
            }
            const added = mergeIntoBlacklist(names);
            log(`Imported: ${added} new entry(ies), ${names.length - added} already present`);
            const msg = added > 0
                ? `Добавлено новых имён: ${added}.\nВсего в списке: ${blacklist.length}.`
                : `Новых имён не найдено — все уже в списке (${blacklist.length}).`;
            alert(msg);
            if (onDone) onDone();
        };
        reader.readAsText(file, 'utf-8');
    }

    // ---------- styles ----------
    function injectStyles() {
        if (document.getElementById('habr-bl-styles')) return;
        const style = document.createElement('style');
        style.id = 'habr-bl-styles';
        style.textContent = `
            /*
             * Inline pills next to the username (feed items, article header).
             * Applies to both the author and company buttons.
             */
            .tm-user-info__user .btn.habr-bl-hide-btn,
            .tm-user-info__user .btn.habr-bl-company-btn {
                margin-left: 2px;
                padding: 0 8px;
                height: 18px;
                min-height: 0;
                font-size: 11px;
                line-height: 16px;
                align-self: center;
            }
            .habr-bl-hide-btn.habr-bl-is-hidden {
            }

            /* Manager panel */
            #habr-bl-panel {
                position: fixed; z-index: 99999; display: none;
                flex-direction: column;
                width: 340px; max-height: 60vh;
                background: #fff; color: #1a1a1a;
                border: 1px solid rgba(0,0,0,.15); border-radius: 10px;
                box-shadow: 0 6px 30px rgba(0,0,0,.3);
                font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                overflow: hidden;
            }
            @media (prefers-color-scheme: dark) {
                #habr-bl-panel {
                    background: #1f2329; color: #e6e6e6;
                    border-color: rgba(255,255,255,.12);
                }
            }
            #habr-bl-panel .habr-bl-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 10px 14px; font-weight: 600;
                border-bottom: 1px solid rgba(128,128,128,.25);
            }
            #habr-bl-panel .habr-bl-close {
                background: transparent; border: none; cursor: pointer;
                font-size: 20px; line-height: 1; color: inherit; padding: 0 4px;
            }

            /* Options row (below header, above list) */
            #habr-bl-panel .habr-bl-options {
                padding: 10px 14px;
                border-bottom: 1px solid rgba(128,128,128,.2);
            }
            #habr-bl-panel .habr-bl-options label {
                display: flex; align-items: center; justify-content: space-between;
                gap: 8px;
                cursor: pointer;
                user-select: none;
                /* Match the .habr-bl-header title style. */
                font-size: 13px;
                font-weight: 600;
            }
            #habr-bl-panel .habr-bl-options input[type="checkbox"] {
                margin: 0 4px 0 0;
                width: 14px; height: 14px;
                cursor: pointer;
                accent-color: #629fbc;
                order: 2; /* keep checkbox on the right if flex ever flips */
            }
            #habr-bl-panel .habr-bl-options span {
                order: 1;
            }

            #habr-bl-panel .habr-bl-body { flex: 1; overflow-y: auto; padding: 4px 0; }
            #habr-bl-panel .habr-bl-row {
                display: flex; align-items: center; justify-content: space-between;
                padding: 6px 14px; gap: 8px;
            }
            #habr-bl-panel .habr-bl-row:hover { background: rgba(128,128,128,.12); }
            #habr-bl-panel .habr-bl-row span {
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            #habr-bl-panel .habr-bl-rm {
                flex: 0 0 auto; cursor: pointer; font-size: 14px; line-height: 1;
                padding: 2px 7px; border-radius: 6px;
                background: transparent; color: #c83c3c;
                border: 1px solid rgba(200,60,60,.6);
            }
            #habr-bl-panel .habr-bl-rm:hover { background: rgba(200,60,60,.15); }

            #habr-bl-panel .habr-bl-footer {
                display: flex; flex-wrap: wrap; justify-content: center;
                gap: 2px 10px;
                padding: 8px 10px; font-size: 12px;
                border-top: 1px solid rgba(128,128,128,.25);
            }
            #habr-bl-panel .habr-bl-footer button {
                background: transparent; border: none; color: inherit;
                cursor: pointer; padding: 2px 6px; border-radius: 4px;
                font: inherit; opacity: .75;
            }
            #habr-bl-panel .habr-bl-footer button:hover {
                opacity: 1; background: rgba(128,128,128,.15);
            }
            #habr-bl-panel .habr-bl-empty {
                padding: 20px; text-align: center; opacity: .6;
            }
        `;
        document.head.appendChild(style);
    }

    // ---------- inline "hide author" button ----------
    function updateHideButton(btn, name, isToggleMode) {
        const isHidden = isBlacklisted(name);
        if (isToggleMode) {
            btn.textContent = isHidden ? 'Автор в чёрном списке — вернуть' : 'Скрыть статьи автора';
            btn.title = isHidden
                ? `Убрать «${name}» из чёрного списка`
                : `Добавить «${name}» в чёрный список`;
            btn.classList.toggle('habr-bl-is-hidden', isHidden);
        } else {
            btn.textContent = 'Скрыть статьи автора';
            btn.title = `Добавить «${name}» в чёрный список`;
            btn.classList.remove('habr-bl-is-hidden');
        }
    }

    function refreshPanelIfOpen() {
        if (panelEl && panelEl.style.display === 'flex') {
            renderPanel();
        }
    }

    function createHideButton(name, isToggleMode) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn_transparent btn_small tm-button_color-horizon habr-bl-hide-btn';
        updateHideButton(btn, name, isToggleMode);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (isToggleMode) {
                if (isBlacklisted(name)) {
                    removeFromBlacklist(name);
                } else {
                    addToBlacklist(name);
                }
                updateHideButton(btn, name, true);
                processFeedItems();
                refreshPanelIfOpen();
            } else {
                if (addToBlacklist(name)) processFeedItems();
            }

            btn.blur();
        });

        return btn;
    }

    // Company button (feed): one-shot add-to-blacklist, hides the article.
    function createCompanyHideButton(companyName) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn_transparent btn_small tm-button_color-horizon habr-bl-company-btn';
        btn.textContent = 'Скрыть статьи компании';
        btn.title = `Добавить компанию «${companyName}» в чёрный список`;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (addToBlacklist(companyName)) processFeedItems();
            btn.blur();
        });

        return btn;
    }

    function injectHideButton(article, name, isReadingView) {
        let btn = article.querySelector('.habr-bl-hide-btn');
        if (btn) {
            updateHideButton(btn, name, isReadingView);
            return;
        }
        const userSpan = article.querySelector('.tm-user-info__user');
        if (!userSpan) return;

        btn = createHideButton(name, isReadingView);
        userSpan.appendChild(document.createTextNode(' '));
        userSpan.appendChild(btn);
    }

    // ---------- feed processing ----------
    function processFeedItems() {
        if (isUserSubpage()) return;
        if (isCompanyPage()) return;

        const articles = document.querySelectorAll('article.tm-articles-list__item');
        for (const article of articles) {
            const author = getAuthorName(article);
            const company = getCompanyName(article);

            if (hideAllCompanyArticles && company) {
                const titleLink = article.querySelector('a.tm-title__link');
                const title = titleLink ? titleLink.textContent.trim() : '';
                const link = titleLink ? titleLink.getAttribute('href') : '';
                log(`Hiding (all companies) | ${title} | ${link}`);
                article.remove();
                continue;
            }

            const authorBlacklisted = author && isBlacklisted(author);
            const companyBlacklisted = company && isBlacklisted(company);

            if (authorBlacklisted || companyBlacklisted) {
                const titleLink = article.querySelector('a.tm-title__link');
                const title = titleLink ? titleLink.textContent.trim() : '';
                const link = titleLink ? titleLink.getAttribute('href') : '';
                const reason = authorBlacklisted
                    ? `author: ${author}`
                    : `company: ${company}`;
                log(`Hiding (${reason}) | ${title} | ${link}`);
                article.remove();
                continue;
            }

            injectFeedItem(article, author, company);
        }
    }

    function injectFeedItem(article, author, company) {
        const userSpan = article.querySelector('.tm-user-info__user');
        if (!userSpan) return;

        if (company) {
            const existing = article.querySelector('.habr-bl-company-btn');
            if (!existing) {
                const cBtn = createCompanyHideButton(company);
                userSpan.appendChild(document.createTextNode(' '));
                userSpan.appendChild(cBtn);
            }
        }

        if (author) {
            injectHideButton(article, author, false);
        }
    }

    // ---------- article (reading) page processing ----------
    function processReadingPage() {
        const article = document.querySelector('article.tm-article-presenter__content');
        if (!article) return;

        if (!/^\/ru\/(?:companies\/[^\/]+\/)?(articles|news)\/\d+\/?$/.test(location.pathname)) return;

        const name = getAuthorName(article);
        if (!name) return;

        injectHideButton(article, name, true);
    }

    // ---------- company toggle button (shared) ----------
    function updateCompanyToggleButton(btn, companyName) {
        const isHidden = isBlacklisted(companyName);
        btn.textContent = isHidden ? 'Компания в чёрном списке — вернуть' : 'Скрыть статьи компании';
        btn.title = isHidden
            ? `Убрать «${companyName}» из чёрного списка`
            : `Добавить «${companyName}» в чёрный список`;
        btn.classList.toggle('habr-bl-is-hidden', isHidden);
    }

    function createCompanyToggleButton(companyName) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn_transparent btn_small tm-button_color-horizon habr-bl-company-btn';
        updateCompanyToggleButton(btn, companyName);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isBlacklisted(companyName)) {
                removeFromBlacklist(companyName);
            } else {
                addToBlacklist(companyName);
            }
            updateCompanyToggleButton(btn, companyName);
            processFeedItems();
            refreshPanelIfOpen();
            btn.blur();
        });

        return btn;
    }

    function insertCompanyToggleIntoCard(container, company) {
        const existing = container.querySelector('.habr-bl-company-btn');
        if (existing) {
            updateCompanyToggleButton(existing, company);
            return;
        }

        const sampleBtn = container.querySelector('button.btn');
        const btn = createCompanyToggleButton(company);
        btn.classList.add('tm-company-profile-card__button');

        if (sampleBtn) {
            for (const attr of sampleBtn.attributes) {
                if (attr.name.startsWith('data-v-')) {
                    btn.setAttribute(attr.name, attr.value);
                }
            }
        }

        const isReverse = getComputedStyle(container).flexDirection === 'row-reverse';
        if (isReverse) {
            container.appendChild(btn);
        } else if (container.firstElementChild) {
            container.insertBefore(btn, container.firstElementChild);
        } else {
            container.appendChild(btn);
        }
    }

    // ---------- company article reading page ----------
    function processReadingCompanyCard() {
        const m = location.pathname.match(/^\/ru\/companies\/([^\/]+)\/articles\/\d+\/?$/);
        if (!m) return;

        const company = decodeURIComponent(m[1]);
        const container = document.querySelector('.tm-company-profile-card__buttons');
        if (!container) return;

        insertCompanyToggleIntoCard(container, company);
    }

    // ---------- company profile / listing pages ----------
    function processCompanyProfile() {
        const company = getCompanyAliasFromUrl();
        if (!company) return;

        const container = document.querySelector('.tm-company-profile-card__buttons');
        if (!container) return;

        insertCompanyToggleIntoCard(container, company);
    }

    // ---------- user profile page processing ----------
    function processUserProfile() {
        const m = location.pathname.match(/^\/ru\/users\/([^\/]+)\//);
        if (!m) return;

        const card = document.querySelector('.tm-user__user-card');
        if (!card) return;

        const buttons = card.querySelector('.buttons');
        if (!buttons) return;

        const nicknameEl = card.querySelector('.nickname');
        const alias = nicknameEl
            ? nicknameEl.textContent.trim().replace(/^@/, '')
            : decodeURIComponent(m[1]);
        if (!alias) return;

        const existingBtn = buttons.querySelector('.habr-bl-profile-toggle button.habr-bl-hide-btn');
        if (existingBtn) {
            updateHideButton(existingBtn, alias, true);
            return;
        }

        const wrap = document.createElement('div');
        wrap.className = 'button habr-bl-profile-toggle';

        const sampleWrap = buttons.querySelector('.button');
        if (sampleWrap) {
            for (const attr of sampleWrap.attributes) {
                if (attr.name.startsWith('data-v-')) {
                    wrap.setAttribute(attr.name, attr.value);
                }
            }
        }

        const btn = createHideButton(alias, true);
        wrap.appendChild(btn);
        buttons.appendChild(wrap);
    }

    function processPages() {
        processFeedItems();
        processReadingPage();
        processReadingCompanyCard();
        processCompanyProfile();
        processUserProfile();
    }

    // ---------- tab-strip injection ----------
    function injectTabLink() {
        const tabsArea = document.querySelector('.tabs.tm-tabs_page-header .tabs-scroll-area');
        if (!tabsArea) return;
        if (tabsArea.querySelector('.habr-bl-tab-item')) return;

        const sampleLink = tabsArea.querySelector('.tab-link');
        if (!sampleLink) return;

        const scopeAttrs = [...sampleLink.attributes]
            .filter(a => a.name.startsWith('data-v-'))
            .map(a => ({ name: a.name, value: a.value }));

        const item = document.createElement('span');
        item.className = 'tab-item habr-bl-tab-item';

        const link = document.createElement('a');
        link.className = 'tab-link habr-bl-tab-link';
        link.href = '#';
        link.textContent = 'Хаброскрипт';
        link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePanel();
        });

        for (const a of scopeAttrs) {
            item.setAttribute(a.name, a.value);
            link.setAttribute(a.name, a.value);
        }

        item.appendChild(link);
        tabsArea.appendChild(item);
    }

    // ---------- manager panel ----------
    let panelEl = null;

    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = 'habr-bl-panel';
        panel.innerHTML = `
            <div class="habr-bl-header">
                <span class="habr-bl-title">Скрытые авторы</span>
                <button class="habr-bl-close" type="button" title="Закрыть">×</button>
            </div>
            <div class="habr-bl-options">
                <label>
                    <span>Скрывать все статьи компаний</span>
                    <input type="checkbox" class="habr-bl-hide-companies">
                </label>
            </div>
            <div class="habr-bl-body"></div>
            <div class="habr-bl-footer">
                <button class="habr-bl-import" type="button" title="Добавить имена из текстового файла">Импорт</button>
                <button class="habr-bl-export" type="button" title="Сохранить список в текстовый файл">Экспорт</button>
                <button class="habr-bl-reset"  type="button" title="Вернуть список по умолчанию">Сброс</button>
                <button class="habr-bl-clear"  type="button" title="Очистить весь список">Очистить</button>
            </div>
            <input class="habr-bl-file" type="file" accept=".txt,text/plain,text/*" style="display:none">
        `;

        const fileInput = panel.querySelector('.habr-bl-file');
        const hideCompaniesCb = panel.querySelector('.habr-bl-hide-companies');

        hideCompaniesCb.checked = hideAllCompanyArticles;

        hideCompaniesCb.addEventListener('change', () => {
            hideAllCompanyArticles = hideCompaniesCb.checked;
            saveHideAllCompanies(hideAllCompanyArticles);
            log(`Hide all company articles: ${hideAllCompanyArticles}`);
            processFeedItems();
        });

        panel.querySelector('.habr-bl-close').addEventListener('click', () => {
            panel.style.display = 'none';
        });

        panel.querySelector('.habr-bl-export').addEventListener('click', () => {
            exportBlacklist();
        });

        panel.querySelector('.habr-bl-import').addEventListener('click', () => {
            fileInput.value = '';
            fileInput.click();
        });

        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            importBlacklistFromFile(file, () => {
                renderPanel();
                processPages();
            });
        });

        panel.querySelector('.habr-bl-clear').addEventListener('click', () => {
            if (confirm('Очистить весь чёрный список?')) {
                blacklist = [];
                saveBlacklist(blacklist);
                renderPanel();
                processPages();
            }
        });

        panel.querySelector('.habr-bl-reset').addEventListener('click', () => {
            if (confirm('Сбросить чёрный список к значениям по умолчанию?')) {
                blacklist = [...DEFAULT_BLACKLIST];
                saveBlacklist(blacklist);
                renderPanel();
                processPages();
            }
        });

        document.body.appendChild(panel);

        document.addEventListener('click', (e) => {
            if (panel.style.display !== 'flex') return;
            const path = e.composedPath();
            if (path.includes(panel)) return;
            if (path.some(n => n.classList && n.classList.contains('habr-bl-tab-item'))) return;
            panel.style.display = 'none';
        });

        return panel;
    }

    function ensurePanel() {
        if (panelEl && document.body.contains(panelEl)) return panelEl;
        panelEl = buildPanel();
        return panelEl;
    }

    function renderPanel() {
        const panel = ensurePanel();

        const titleEl = panel.querySelector('.habr-bl-title');
        if (titleEl) {
            titleEl.textContent = `Скрытые авторы (${blacklist.length})`;
        }

        const cb = panel.querySelector('.habr-bl-hide-companies');
        if (cb) cb.checked = hideAllCompanyArticles;

        const body = panel.querySelector('.habr-bl-body');
        body.innerHTML = '';
        if (blacklist.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'habr-bl-empty';
            empty.textContent = 'Список пуст';
            body.appendChild(empty);
            return;
        }
        [...blacklist]
            .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
            .forEach(name => {
                const row = document.createElement('div');
                row.className = 'habr-bl-row';

                const span = document.createElement('span');
                span.textContent = name;
                span.title = name;

                const rm = document.createElement('button');
                rm.type = 'button';
                rm.className = 'habr-bl-rm';
                rm.textContent = '×';
                rm.title = `Убрать ${name} из чёрного списка`;
                rm.addEventListener('click', () => {
                    removeFromBlacklist(name);
                    renderPanel();
                    processPages();
                });

                row.appendChild(span);
                row.appendChild(rm);
                body.appendChild(row);
            });
    }

    function positionPanel() {
        if (!panelEl || panelEl.style.display !== 'flex') return;

        const panelW = panelEl.offsetWidth || 340;
        const tab = document.querySelector('.habr-bl-tab-item');

        if (tab) {
            const rect = tab.getBoundingClientRect();
            let left = rect.left + rect.width / 2 - panelW / 2;
            if (left < 10) left = 10;
            if (left + panelW > window.innerWidth - 10) {
                left = window.innerWidth - panelW - 10;
            }
            panelEl.style.left = left + 'px';
            panelEl.style.top = (rect.bottom + 8) + 'px';
        } else {
            panelEl.style.left = (window.innerWidth - panelW - 20) + 'px';
            panelEl.style.top = (window.innerHeight - 80 - panelEl.offsetHeight) + 'px';
        }
    }

    function togglePanel() {
        const panel = ensurePanel();
        if (panel.style.display === 'flex') {
            panel.style.display = 'none';
            return;
        }
        renderPanel();
        panel.style.display = 'flex';
        requestAnimationFrame(positionPanel);
    }

    // ---------- lifecycle ----------
    let scheduled = false;
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            injectTabLink();
            processPages();
            positionPanel();
        });
    }

    function start() {
        injectStyles();
        injectTabLink();
        processPages();

        new MutationObserver(schedule).observe(document.body, {
            childList: true, subtree: true
        });
        window.addEventListener('resize', positionPanel);

        const origPush = history.pushState;
        const origReplace = history.replaceState;
        history.pushState = function () {
            origPush.apply(this, arguments);
            schedule();
        };
        history.replaceState = function () {
            origReplace.apply(this, arguments);
            schedule();
        };
        window.addEventListener('popstate', schedule);

        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('Показать «Хаброскрипт»', togglePanel);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(start, 500));
    } else {
        setTimeout(start, 500);
    }
})();
