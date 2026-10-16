export function init({ stage, onEntry }) {
  onEntry('ambient', (entry) => {
    const data = entry?.data;
    stage.dataset.nightMode = data?.available && data.dark ? '1' : '0';
    stage.dataset.ambient = data?.available ? '1' : '0';
  });
}
