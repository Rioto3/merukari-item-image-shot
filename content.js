/**
 * メルカリ商品画像ダウンローダー
 * コンテンツスクリプト
 */
(function() {
  'use strict';

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
      
      // 最大40枚試行
      const MAX_IMAGES = 40;
      let successCount = 0;
      let errorCount = 0;
      
      // 同時ダウンロードを制限するため、数枚ずつ処理
      const BATCH_SIZE = 5;
      
      for (let i = 1; i <= MAX_IMAGES; i += BATCH_SIZE) {
        const batchPromises = [];
        
        for (let j = i; j < i + BATCH_SIZE && j <= MAX_IMAGES; j++) {
          batchPromises.push(processImage(itemId, j));
        }
        
        const results = await Promise.all(batchPromises);
        
        // 結果を集計
        results.forEach(result => {
          if (result.success) {
            successCount++;
          } else {
            errorCount++;
          }
        });
        
        // 3枚連続で画像が取得できなければ終了
        if (results.filter(r => !r.success).length >= 3) {
          break;
        }
        
        // ステータス更新
        status.innerText = `${successCount}枚の画像をダウンロード中...`;
      }
      
      // ダウンロード完了メッセージ
      if (successCount > 0) {
        status.innerText = `ダウンロード完了: ${successCount}枚の画像を保存しました`;
        // 5秒後にステータス表示を消す
        setTimeout(() => status.remove(), 5000);
      } else {
        status.innerText = `画像が見つかりませんでした`;
        setTimeout(() => status.remove(), 3000);
      }
    } catch (error) {
      console.error('ダウンロード処理エラー:', error);
      alert('画像ダウンロード中にエラーが発生しました: ' + error.message);
    }
  }

  // 画像を処理する
  async function processImage(itemId, index) {
    const imageUrl = `https://static.mercdn.net/item/detail/orig/photos/${itemId}_${index}.jpg`;
    
    try {
      // 画像の存在チェック
      const response = await fetch(imageUrl, { method: 'HEAD' });
      if (!response.ok) {
        return { success: false, index };
      }
      
      // background scriptに画像ダウンロードを依頼
      browser.runtime.sendMessage({
        action: 'downloadImage',
        url: imageUrl,
        filename: `${itemId}/${itemId}_${index}.jpg`
      });
      
      return { success: true, index };
    } catch (err) {
      console.error(`画像${index}のダウンロード中にエラー: ${err.message}`);
      return { success: false, index, error: err.message };
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