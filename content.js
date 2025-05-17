/**
 * メルカリ商品画像ダウンローダー
 * コンテンツスクリプト
 */
(function() {
  'use strict';

  // 設定
  const CHECK_DELAY = 2000;  // 画像存在チェック間の遅延 (ミリ秒) - 2秒に延長
  const MAX_IMAGES = 40;     // 最大画像枚数
  const MAX_ERRORS = 8;      // 連続エラー時に終了する数 - 8回に延長

  // デバッグログ
  const DEBUG = true;
  function logDebug(...args) {
    if (DEBUG) console.log('[メルカリ画像ダウンローダー]', ...args);
  }

  // 現在の日付をYYMMDD形式で取得する関数
  function getCurrentDateYYMMDD() {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2); // 年の下2桁
    const mm = String(now.getMonth() + 1).padStart(2, '0'); // 月（ゼロ埋め）
    const dd = String(now.getDate()).padStart(2, '0'); // 日（ゼロ埋め）
    return `${yy}${mm}${dd}`;
  }

  // 商品タイトルを取得する関数
  function getItemTitle() {
    // metaタグからタイトルを取得（SEO情報）
    const metaTitle = document.querySelector('meta[property="og:title"]');
    if (metaTitle && metaTitle.content) {
      let title = metaTitle.content.trim();
      
      // 先頭の【.*】を削除
      title = title.replace(/^【.*?】/, '').trim();
      
      // ファイル名に使えない文字を置換
      title = title.replace(/[\\/:*?"<>|]/g, '_');
      
      return title;
    }
    
    // fallback: titleタグからタイトルを取得
    const pageTitle = document.title;
    if (pageTitle) {
      let title = pageTitle.trim();
      
      // 先頭の【.*】を削除
      title = title.replace(/^【.*?】/, '').trim();
      
      // サイト名を除去 (例: "商品名 - メルカリ")
      title = title.split(' - ')[0].trim();
      
      // ファイル名に使えない文字を置換
      title = title.replace(/[\\/:*?"<>|]/g, '_');
      
      return title;
    }
    
    return "no_title"; // タイトルが取得できない場合のデフォルト値
  }

  // ページにダウンロードボタンを追加
  function addDownloadButton() {
    // ボタンがすでに存在する場合は追加しない
    if (document.getElementById('mercari-image-dl-button')) return;

    // ヘッダー要素を取得
    const header = document.querySelector('header');
    if (!header) {
      logDebug('メルカリページのヘッダーが見つかりません、bodyに追加します');
      // ヘッダーがなければbodyに追加
      const body = document.body;
      if (body) {
        const button = createDownloadButton();
        button.style.position = 'fixed';
        button.style.top = '20px';
        button.style.right = '20px';
        button.style.zIndex = '10000';
        body.appendChild(button);
      }
      return;
    }

    // ボタンを作成して追加
    const button = createDownloadButton();
    header.appendChild(button);
  }

  // ダウンロードボタンを作成
  function createDownloadButton() {
    const button = document.createElement('button');
    button.id = 'mercari-image-dl-button';
    button.innerText = '画像一括保存';
    button.addEventListener('click', downloadAllImages);
    return button;
  }

  // ステータス表示要素を作成
  function createStatusElement(message) {
    // 既存のステータス要素があれば削除
    const existingStatus = document.getElementById('mercari-dl-status');
    if (existingStatus) {
      existingStatus.remove();
    }

    const status = document.createElement('div');
    status.id = 'mercari-dl-status';
    status.innerText = message;
    document.body.appendChild(status);
    return status;
  }

  // ステータスを更新
  function updateStatus(message) {
    const status = document.getElementById('mercari-dl-status');
    if (status) {
      status.innerText = message;
    } else {
      createStatusElement(message);
    }
  }

  // 指定時間待機する関数
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 代替ダウンロード方法 - Blob URLを使用したダウンロード
  async function alternativeDownload(url, filename) {
    logDebug(`代替ダウンロード方法を使用: ${url}`);
    try {
      // 進捗状況表示
      const status = document.getElementById('mercari-dl-status');
      if (status) {
        status.innerText = `代替ダウンロード方法で保存中: ${filename}`;
      }
      
      // 画像をフェッチ
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`画像の取得に失敗しました: ${response.status} ${response.statusText}`);
      }
      
      // Blobに変換
      const blob = await response.blob();
      
      // Blob URLの作成とダウンロード
      const objectUrl = URL.createObjectURL(blob);
      
      // ダウンロードリンク作成
      const a = document.createElement('a');
      a.href = objectUrl;
      
      // ファイル名を設定（フォルダは無視）
      const fileName = filename.split('/').pop();
      a.download = fileName;
      
      // 非表示でDOMに追加
      a.style.display = 'none';
      document.body.appendChild(a);
      
      // クリックイベントを発火
      a.click();
      
      // 不要になったら削除
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      }, 100);
      
      if (status) {
        status.innerText = `保存しました: ${fileName}`;
      }
      
      // 成功をbackgroundスクリプトに通知
      browser.runtime.sendMessage({
        action: 'downloadSuccess',
        filename: filename
      });
      
      return true;
    } catch (error) {
      logDebug(`代替ダウンロードエラー: ${error.message}`);
      return false;
    }
  }

  // 画像URLを確認 (より多くのパターンに対応)
  async function checkImageUrl(itemId, index) {
    // 試行するパターンのリスト
    const urlPatterns = [
      // パターン1: 標準の画像URL
      `https://static.mercdn.net/item/detail/orig/photos/${itemId}_${index}.jpg`,
      // パターン2: 0埋め (1桁→2桁)
      `https://static.mercdn.net/item/detail/orig/photos/${itemId}_${String(index).padStart(2, '0')}.jpg`,
      // パターン3: origなしバージョン
      `https://static.mercdn.net/item/detail/photos/${itemId}_${index}.jpg`,
      // パターン4: 拡張子なし (Content-Typeで判断)
      `https://static.mercdn.net/item/detail/orig/photos/${itemId}_${index}`,
      // パターン5: 別フォーマット (PNG)
      `https://static.mercdn.net/item/detail/orig/photos/${itemId}_${index}.png`
    ];
    
    // 各パターンを試行
    for (const url of urlPatterns) {
      try {
        // HEADリクエストの代わりに少しのデータだけを取得するGETリクエスト
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒タイムアウト
        
        const response = await fetch(url, { 
          method: 'GET',
          headers: { 'Range': 'bytes=0-1023' }, // 最初の1KBだけ取得
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok || response.status === 206) {
          logDebug(`画像パターン発見: ${url}`);
          return { success: true, url: url };
        }
      } catch (err) {
        logDebug(`URL確認エラー (${url}): ${err.message}`);
        // 個別のエラーは無視して次のパターンを試す
      }
      
      // パターン間の遅延
      await sleep(500);
    }
    
    return { success: false };
  }

  // ページから画像URLを取得する（APIに依存しない方法）
  function extractImageUrlsFromPage(itemId) {
    // 画像URLのリスト
    const imageUrls = [];
    
    // 方法1: meta og:image から取得
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && ogImage.content) {
      const baseUrl = ogImage.content.split('_')[0]; // 最初の画像のURL
      if (baseUrl) {
        imageUrls.push(ogImage.content); // 最初の画像
      }
    }
    
    // 方法2: img要素から取得
    const imgElements = document.querySelectorAll('img');
    imgElements.forEach(img => {
      const src = img.src || img.dataset.src;
      if (src && src.includes(itemId) && !imageUrls.includes(src)) {
        // 高解像度バージョンのURLに変換
        const highResUrl = convertToHighResUrl(src, itemId);
        if (highResUrl && !imageUrls.includes(highResUrl)) {
          imageUrls.push(highResUrl);
        }
      }
    });
    
    // 方法3: メルカリの商品詳細ページにあるサムネイルから推測
    const thumbnails = document.querySelectorAll('div[role="button"] img');
    thumbnails.forEach((thumb, index) => {
      // サムネイルがあれば対応する高解像度画像のURL生成を試みる
      const patternUrl = `https://static.mercdn.net/item/detail/orig/photos/${itemId}_${index + 1}.jpg`;
      if (!imageUrls.includes(patternUrl)) {
        imageUrls.push(patternUrl);
      }
    });
    
    return [...new Set(imageUrls)]; // 重複を排除
  }

  // サムネイルURLを高解像度URLに変換
  function convertToHighResUrl(url, itemId) {
    if (!url) return null;
    
    // すでに高解像度の場合はそのまま返す
    if (url.includes('/orig/')) {
      return url;
    }
    
    // サムネイルから高解像度URLへの変換パターン
    const patterns = [
      // 画像番号を抽出して高解像度URLを生成
      { regex: /\/(\\d+)\\.jpg/, template: `https://static.mercdn.net/item/detail/orig/photos/${itemId}_$1.jpg` },
      // 画像番号が名前に含まれていない場合、1枚目と仮定
      { regex: /item\\/detail\\//, template: `https://static.mercdn.net/item/detail/orig/photos/${itemId}_1.jpg` }
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern.regex);
      if (match) {
        return pattern.template.replace('$1', match[1]);
      }
    }
    
    return null;
  }

  // すべての画像をダウンロード
  async function downloadAllImages() {
    try {
      // 商品IDを取得
      const url = window.location.href;
      const itemIdMatch = url.match(/\\/item\\/([^/?]+)/);
      
      if (!itemIdMatch || !itemIdMatch[1]) {
        alert('商品IDが取得できませんでした');
        return;
      }
      
      const itemId = itemIdMatch[1];
      logDebug(`商品ID: ${itemId}`);
      
      // 商品タイトルを取得
      const itemTitle = getItemTitle();
      logDebug(`商品タイトル: ${itemTitle}`);
      
      // 日付を取得
      const currentDate = getCurrentDateYYMMDD();
      
      // フォルダ名を生成
      const folderName = `${currentDate}-${itemTitle}`;
      logDebug(`保存フォルダ名: ${folderName}`);
      
      // ステータス表示要素を作成
      const status = createStatusElement('画像を探しています...');
      
      // ダウンロードボタンを無効化
      const button = document.getElementById('mercari-image-dl-button');
      if (button) {
        button.disabled = true;
        button.innerText = 'ダウンロード中...';
      }
      
      // ページから画像URLを抽出
      const imageUrls = extractImageUrlsFromPage(itemId);
      logDebug(`ページから ${imageUrls.length} 個の画像URLを抽出しました`, imageUrls);
      
      if (imageUrls.length === 0) {
        updateStatus('画像が見つかりませんでした。');
        if (button) {
          button.disabled = false;
          button.innerText = '画像一括保存';
        }
        return;
      }
      
      updateStatus(`${imageUrls.length}枚の画像をダウンロードします...`);
      
      // バックグラウンドスクリプトに一括ダウンロード要求を送信
      browser.runtime.sendMessage({
        action: 'directDownload',
        urls: imageUrls,
        itemId: itemId,
        folderName: folderName
      });
      
      // ダウンロード進捗と完了を待機するためのメッセージリスナー
      browser.runtime.onMessage.addListener(function messageListener(message) {
        if (message.action === 'downloadProgress') {
          updateStatus(`画像 ${message.current}/${message.total} をダウンロード中...`);
        }
        else if (message.action === 'downloadError') {
          logDebug(`画像 ${message.index + 1} のダウンロードに失敗: ${message.error}`);
        }
        else if (message.action === 'allDownloadsComplete') {
          updateStatus(`ダウンロード完了: ${imageUrls.length}枚の画像を保存しました`);
          
          // ボタンを再度有効化
          if (button) {
            button.disabled = false;
            button.innerText = '画像一括保存';
          }
          
          // リスナーを削除
          browser.runtime.onMessage.removeListener(messageListener);
          
          // 10秒後にステータス表示を消す
          setTimeout(() => {
            const status = document.getElementById('mercari-dl-status');
            if (status) status.remove();
          }, 10000);
        }
      });
      
    } catch (error) {
      console.error('ダウンロード処理エラー:', error);
      updateStatus(`エラーが発生しました: ${error.message}`);
      
      // エラー時もボタンを再度有効化
      const button = document.getElementById('mercari-image-dl-button');
      if (button) {
        button.disabled = false;
        button.innerText = '画像一括保存';
      }
    }
  }

  // バックグラウンドからの代替ダウンロード要求を受け取る
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'alternativeDownload') {
      logDebug('代替ダウンロード要求を受信:', message.url);
      alternativeDownload(message.url, message.filename);
    }
  });

  // ページ読み込み完了時にボタンを追加
  window.addEventListener('load', addDownloadButton);
  
  // DOMが変更された場合にもボタン追加を試みる（SPAサイト対応）
  const observer = new MutationObserver(function(mutations) {
    if (!document.getElementById('mercari-image-dl-button')) {
      addDownloadButton();
    }
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
})();