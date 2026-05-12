## Frontend

### Zustand Usage

```jsx
import { useStore } from '../../model';

// state
const editsForComparisons = useStore(state => state.editsForComparisons);
// setState
const setEditsForComparisons = useStore(state => state.setEditsForComparisons);
// Pure updater. It is similar to setState, but accepts a function that receives
// the previous state and returns the next state.
// Use it when the next state f(t + 1) depends on the previous state f(t).
const updateEditsForComparisons = useStore(
  state => state.updateEditsForComparisons,
);
// editPlans stores historical edit-plan analysis results and is persisted in zustand.
// Each editPlans entry stores the edit information for one plan as EditComponent[].
// The snippet below derives newFrameRisks after applying the edits.
let newFrameRisks = [...frameRisks]; // Assume newFrameRisks contains the pre-edit risk values.
editsForComparisons.forEach(edit => {
  const startIndex = edit.startIndex;
  const endIndex = edit.endIndex;
  const risk = edit.risk;
  newFrameRisks = [...newFrameRisks.slice(0, startIndex), ...risk, ...newFrameRisks.slice(endIndex)];
});

return (
  <div>
    value is {editsForComparisons}
    <button onClick={() => setEditsForComparisons([1, 2, 3])}>Set</button>
    <button
      onClick={() => updateEditsForComparisons(oldArray => [...oldArray, 4])}
    >
      Update
    </button>
  </div>
);
```
