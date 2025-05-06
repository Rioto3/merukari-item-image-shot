// background.js の修正箇所

/**
 * メルカリ商品画像ダウンローダー
 * バックグラウンドスクリプト - 改善版
 */

// ダウンロードキューと同時ダウンロード数の制限
const downloadQueue = [];
const MAX_CONCURRENT_DOWNLOADS = 1;
const DOWNLOAD_DELAY = 5000; // 5秒に延長
const RETRY_ATTEMPTS = 3;
let activeDownloads = 0;

// デバッグログ
const DEBUG = true;
function logDebug(...args) {
  if (DEBUG) console.log('[メルカリ画像ダウンローダー]', ...args);
}

// 成功 / 失敗カウンター
let successCount = 0;
let failureCount = 0;

// 画像をフェッチして直接バイナリデータを取得する関数
async function fetchImageAsBinary(url) {
  logDebug(`画像をフェッチ中: ${url}`);
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit', // CORSの問題を回避
      cache: 'no-cache',
      headers: {
        'Accept': 'image/*'
      }
    });
    
    if (!response.ok) {
      throw new Error(`画像の取得に失敗しました: ${response.status}`);
    }
    
    const blob = await response.blob();
    return blob;
  } catch (error) {
    logDebug(`画像のフェッチエラー: ${error.message}`);
    throw error;
  }
}

// メッセージリスナーを設定
browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  // 画像ダウンロード要求
  if (message.action === 'downloadImage') {
    logDebug('ダウンロード要求を受信:', message.url);
    
    try {
      // 画像をバックグラウンドでフェッチ
      const imageBlob = await fetchImageAsBinary(message.url);
      
      // Blob URLを作成
      const objectUrl = URL.createObjectURL(imageBlob);
      
      // ダウンロードを試行
      const downloadId = await browser.downloads.download({
        url: objectUrl,
        filename: message.filename,
        conflictAction: 'uniquify',
        saveAs: false
      });
      
      logDebug(`ダウンロードID: ${downloadId} を開始`);
      
      // ダウンロード完了を追跡して結果を返す
      browser.downloads.onChanged.addListener(function listener(delta) {
        if (delta.id === downloadId && delta.state) {
          if (delta.state.current === 'complete') {
            logDebug(`ダウンロード完了: ${message.filename}`);
            browser.downloads.onChanged.removeListener(listener);
            URL.revokeObjectURL(objectUrl);
            successCount++;
            
            // 成功を通知
            browser.tabs.sendMessage(sender.tab.id, {
              action: 'downloadComplete',
              success: true,
              filename: message.filename
            });
          } 
          else if (delta.state.current === 'interrupted') {
            logDebug(`ダウンロード中断: ${message.filename}`);
            browser.downloads.onChanged.removeListener(listener);
            URL.revokeObjectURL(objectUrl);
            failureCount++;
            
            // 失敗を通知
            browser.tabs.sendMessage(sender.tab.id, {
              action: 'downloadComplete',
              success: false,
              filename: message.filename,
              error: delta.error?.current || '不明なエラー'
            });
          }
        }
      });
    } catch (error) {
      logDebug(`ダウンロード処理エラー: ${error.message}`);
      // エラーを通知
      browser.tabs.sendMessage(sender.tab.id, {
        action: 'downloadComplete',
        success: false,
        filename: message.filename,
        error: error.message
      });
    }
    
    // 非同期処理を続行するため true を返す
    return true;
  }
  
  // 直接ダウンロードの要求（URLから直接ダウンロード）
  if (message.action === 'directDownload') {
    logDebug('一括ダウンロード要求を受信');
    
    // タブIDを保存
    const tabId = sender.tab.id;
    
    // 画像URLのリスト
    const { urls, itemId } = message;
    
    // 順番にダウンロード
    for (let i = 0; i < urls.length; i++) {
      try {
        // 進捗を通知
        browser.tabs.sendMessage(tabId, {
          action: 'downloadProgress',
          current: i + 1,
          total: urls.length
        });
        
        // 画像をフェッチ
        const imageBlob = await fetchImageAsBinary(urls[i]);
        
        // Blob URLを作成
        const objectUrl = URL.createObjectURL(imageBlob);
        
        // ファイル名を設定
        const filename = `${itemId}/${itemId}_${i + 1}.jpg`;
        
        // ダウンロード
        await new Promise((resolve, reject) => {
          browser.downloads.download({
            url: objectUrl,
            filename: filename,
            conflictAction: 'uniquify',
            saveAs: false
          }).then(downloadId => {
            const listener = delta => {
              if (delta.id === downloadId && delta.state) {
                if (delta.state.current === 'complete') {
                  browser.downloads.onChanged.removeListener(listener);
                  URL.revokeObjectURL(objectUrl);
                  resolve();
                } else if (delta.state.current === 'interrupted') {
                  browser.downloads.onChanged.removeListener(listener);
                  URL.revokeObjectURL(objectUrl);
                  reject(new Error(`ダウンロード中断: ${delta.error?.current || '不明なエラー'}`));
                }
              }
            };
            
            browser.downloads.onChanged.addListener(listener);
          }).catch(reject);
        });
        
        // 遅延を入れる
        await new Promise(resolve => setTimeout(resolve, DOWNLOAD_DELAY));
        
      } catch (error) {
        logDebug(`画像 ${i + 1} のダウンロードエラー: ${error.message}`);
        // エラーを通知するが処理は続行
        browser.tabs.sendMessage(tabId, {
          action: 'downloadError',
          index: i,
          error: error.message
        });
        
        // より長い遅延を入れる
        await new Promise(resolve => setTimeout(resolve, DOWNLOAD_DELAY * 2));
      }
    }
    
    // 完了を通知
    browser.tabs.sendMessage(tabId, {
      action: 'allDownloadsComplete',
      success: true
    });
    
    return true;
  }
});

// アドオンのインストール/更新時に実行
browser.runtime.onInstalled.addListener(details => {
  logDebug('メルカリ商品画像ダウンローダーがインストールされました', details);
  // カウンターリセット
  successCount = 0;
  failureCount = 0;
});

// -----------------------------------------------------
// content.js の修正箇所

/**
 * メルカリ商品画像ダウンローダー
 * コンテンツスクリプト - 改善版
 */
(function() {
  'use strict';

  // 設定
  const CHECK_DELAY = 2000;
  const MAX_IMAGES = 40;
  const MAX_ERRORS = 8;

  // デバッグログ
  const DEBUG = true;
  function logDebug(...args) {
    if (DEBUG) console.log('[メルカリ画像ダウンローダー]', ...args);
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
      { regex: /\/(\d+)\.jpg/, template: `https://static.mercdn.net/item/detail/orig/photos/${itemId}_$1.jpg` },
      // 画像番号が名前に含まれていない場合、1枚目と仮定
      { regex: /item\/detail\//, template: `https://static.mercdn.net/item/detail/orig/photos/${itemId}_1.jpg` }
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern.regex);
      if (match) {
        return pattern.template.replace('$1', match[1]);
      }
    }
    
    return null;
  }

  // すべての画像をダウンロード - 改良版
  async function downloadAllImages() {
    try {
      // 商品IDを取得
      const url = window.location.href;
      const itemIdMatch = url.match(/\/item\/([^/?]+)/);
      
      if (!itemIdMatch || !itemIdMatch[1]) {
        alert('商品IDが取得できませんでした');
        return;
      }
      
      const itemId = itemIdMatch[1];
      logDebug(`商品ID: ${itemId}`);
      
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
        itemId: itemId
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