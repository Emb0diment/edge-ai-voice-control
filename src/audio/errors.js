/** Surface the capture stage without misreporting model or website failures. */
export function captureErrorMessage(error) {
  const detail = error?.message || String(error);
  const name = error?.name && error.name !== 'Error' ? `${error.name}: ` : '';
  return `无法读取当前标签页的声音。模型已保留，可直接重试。若仍失败，请在 edge://extensions 重新加载此扩展，再刷新视频网页并重新打开面板。\n原始错误：${name}${detail}`;
}
