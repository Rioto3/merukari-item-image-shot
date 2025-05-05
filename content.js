/**
 * メルカリ商品画像ダウンローダー
 * コンテンツスクリプト
 */
(function() {
  'use strict';

  // 設定
  const CHECK_DELAY = 500; // 画像存在チェック間の遅延 (ミリ秒)
  const BATCH_SIZE = 3;    // 一度に処理する画像数
  const MAX_IMAGES = 40;   // 最大画像枚数
  const MAX_ERRORS = 3;    // 連続エラー時に終了する数

  // ページにダウンロードボタンを追加
  function addDownloadButton() {
    // ボタンがすでに存在する場合は追加しない
    if (document.getElementById('mercari-image-dl-button')) return;

    // ヘッダー要素を取得
    const header = document.querySelector('header');
    if (!header) {
      console.warn('メルカリページのヘッダーが見つかりません');
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
      
      // ステータス表示要素を作成
      const status = createStatusElement('ダウンロードを開始します...');
      
      let successCount = 0;
      let errorCount = 0;
      let consecutiveErrors = 0;
      
      // バッチ処理でループ
      for (let i = 1; i <= MAX_IMAGES; i++) {
        try {
          // 画像の存在チェック (遅延を入れる)
          await sleep(CHECK_DELAY);
          
          const imageUrl = `https://static.mercdn.net/item/detail/orig/photos/${itemId}_${i}.jpg`;
          const response = await fetch(imageUrl, { method: 'HEAD' });
          
          if (!response.ok) {
            errorCount++;
            consecutiveErrors++;
            // 連続エラーの場合、終了判定
            if (consecutiveErrors >= MAX_ERRORS) {
              break;
            }
            continue;
          }
          
          // エラーカウントリセット (連続ではない)
          consecutiveErrors = 0;
          
          // ダウンロード要求を送信
          browser.runtime.sendMessage({
            action: 'downloadImage',
            url: imageUrl,
            filename: `${itemId}/${itemId}_${i}.jpg`
          });
          
          successCount++;
          // ステータス更新 (5枚ごと)
          if (successCount % 5 === 0 || successCount === 1) {
            status.innerText = `${successCount}枚の画像をダウンロード中...`;
          }
          
        } catch (err) {
          console.error(`画像${i}の処理中にエラー: ${err.message}`);
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
        // 7秒後にステータス表示を消す
        setTimeout(() => status.remove(), 7000);
      } else {
        status.innerText = `画像が見つかりませんでした`;
        setTimeout(() => status.remove(), 3000);
      }
    } catch (error) {
      console.error('ダウンロード処理エラー:', error);
      alert('画像ダウンロード中にエラーが発生しました: ' + error.message);
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