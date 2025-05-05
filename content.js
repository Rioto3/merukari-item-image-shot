/**
 * メルカリ商品画像ダウンローダー
 * コンテンツスクリプト
 */
(function() {
  'use strict';

  // 設定
  const CHECK_DELAY = 1000;  // 画像存在チェック間の遅延 (ミリ秒) - 1秒に延長
  const MAX_IMAGES = 40;     // 最大画像枚数
  const MAX_ERRORS = 5;      // 連続エラー時に終了する数 - 5回に延長

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

  // 指定時間待機する関数
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 画像URLを確認 (複数パターンに対応)
  async function checkImageUrl(itemId, index) {
    // パターン1: 標準の画像URL
    const standardUrl = `https://static.mercdn.net/item/detail/orig/photos/${itemId}_${index}.jpg`;
    
    try {
      const response = await fetch(standardUrl, { method: 'HEAD' });
      if (response.ok) {
        return { success: true, url: standardUrl };
      }
      
      // パターン2: 別の可能性があるフォーマット (例えば数字の前に0をつける)
      // 例: m1234_1.jpg → m1234_01.jpg
      const paddedIndexUrl = `https://static.mercdn.net/item/detail/orig/photos/${itemId}_${String(index).padStart(2, '0')}.jpg`;
      
      const response2 = await fetch(paddedIndexUrl, { method: 'HEAD' });
      if (response2.ok) {
        return { success: true, url: paddedIndexUrl };
      }
      
      return { success: false };
    } catch (err) {
      logDebug(`Image check error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // すべての画像をダウンロード
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
      const status = createStatusElement('ダウンロードを開始します...');
      
      let successCount = 0;
      let errorCount = 0;
      let consecutiveErrors = 0;
      
      // ダウンロードボタンを無効化
      const button = document.getElementById('mercari-image-dl-button');
      if (button) {
        button.disabled = true;
        button.innerText = 'ダウンロード中...';
      }
      
      // 1枚ずつ処理
      for (let i = 1; i <= MAX_IMAGES; i++) {
        try {
          // 状況表示を更新
          status.innerText = `画像を探しています... (${i}/${MAX_IMAGES})`;
          
          // 画像の存在チェック (遅延を入れる)
          await sleep(CHECK_DELAY);
          
          // 複数パターンで画像URLをチェック
          const result = await checkImageUrl(itemId, i);
          
          if (!result.success) {
            logDebug(`画像${i}が見つかりませんでした`);
            errorCount++;
            consecutiveErrors++;
            
            // 連続エラーの場合、終了判定
            if (consecutiveErrors >= MAX_ERRORS) {
              logDebug(`${MAX_ERRORS}回連続でエラーが発生したため終了します`);
              break;
            }
            continue;
          }
          
          // エラーカウントリセット (連続ではない)
          consecutiveErrors = 0;
          
          // ダウンロード要求を送信
          browser.runtime.sendMessage({
            action: 'downloadImage',
            url: result.url,
            filename: `${itemId}/${itemId}_${i}.jpg`
          });
          
          logDebug(`画像${i}のダウンロードを開始しました: ${result.url}`);
          
          successCount++;
          // ステータス更新 (1枚ごと)
          status.innerText = `${successCount}枚の画像をダウンロード中...`;
          
        } catch (err) {
          logDebug(`画像${i}の処理中にエラー: ${err.message}`);
          errorCount++;
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_ERRORS) {
            break;
          }
        }
      }
      
      // ダウンロード完了メッセージ
      if (successCount > 0) {
        status.innerText = `ダウンロード完了: ${successCount}枚の画像を保存しました`;
        // 10秒後にステータス表示を消す
        setTimeout(() => status.remove(), 10000);
      } else {
        status.innerText = `画像が見つかりませんでした`;
        setTimeout(() => status.remove(), 3000);
      }
      
      // ボタンを再度有効化
      if (button) {
        button.disabled = false;
        button.innerText = '画像一括保存';
      }
    } catch (error) {
      console.error('ダウンロード処理エラー:', error);
      alert('画像ダウンロード中にエラーが発生しました: ' + error.message);
      
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