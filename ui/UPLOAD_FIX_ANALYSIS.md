# File Upload Fix - Root Cause Analysis and Solution

## Problem Statement
File upload "Click to upload" areas were not opening the file picker when clicked.

## Root Cause Analysis

### The Issue
The upload divs were nested inside an accordion component that has its own `onClick` handler (line 759):
```javascript
onClick={() => setExpandedTaskId(isExpanded ? '' : taskItem.id)}
```

When a user clicked the upload area, BOTH click handlers fired:
1. The upload div's onClick (trying to open file picker)
2. The accordion header's onClick (toggling expand/collapse)

The accordion's onClick was preventing the file picker from opening due to event bubbling.

### Why Previous Attempts Failed

1. **document.createElement() without stopPropagation**: The dynamically created input was clicked, but the accordion also toggled, interfering with the browser's file picker.

2. **Refs without stopPropagation**: Same issue - the accordion's onClick still fired.

3. **Hidden inputs without stopPropagation**: The label triggered the input, but the accordion still interfered.

## The Solution

Use the **HTML label + hidden input pattern WITH event.stopPropagation()**:

### Implementation
```jsx
// Hidden file input
<input
  type="file"
  id={`source-${taskItem.id}`}
  accept="image/*"
  style={{ display: 'none' }}
  onChange={(e) => {
    const file = e.target.files?.[0];
    if (file) {
      updateTask(taskItem.id, { sourceFile: file });
      e.target.value = ''; // Reset for re-uploads
    }
  }}
/>

// Visible label that triggers the input
<label
  htmlFor={`source-${taskItem.id}`}
  onClick={(e) => e.stopPropagation()} // CRITICAL: Prevents accordion from toggling
  style={{
    height: 160,
    border: '2px dashed var(--border)',
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    ...
  }}
>
  Click to upload
</label>
```

### Why This Works

1. **Native HTML semantics**: The `<label htmlFor>` pattern is the standard HTML way to trigger file inputs, ensuring maximum browser compatibility.

2. **Event propagation control**: `e.stopPropagation()` on the label prevents the click event from bubbling up to the accordion header, so only the file picker opens.

3. **Unique IDs**: Each task has unique input IDs (`source-${taskItem.id}`, `target-${taskItem.id}`) ensuring labels trigger the correct inputs.

4. **Input reset**: `e.target.value = ''` allows users to re-upload the same file if needed.

5. **Button stopPropagation**: Remove buttons also use `e.stopPropagation()` to prevent accidentally toggling the accordion when removing files.

## Testing Checklist

- [x] Code compiles without errors
- [ ] Click "Click to upload" opens file picker (not accordion)
- [ ] Selecting a file updates the preview
- [ ] File name displays correctly
- [ ] Remove button works without toggling accordion
- [ ] Can re-upload same file after removal
- [ ] Works for both Start Screen and Stop Screen
- [ ] Works across multiple tasks
- [ ] Hover effects work correctly

## Files Modified

- `/Users/ankita/Documents/workspace/design-agent-simulator-ui/ui/src/app/configure-test/page.tsx` (lines 859-1030)

## Commit Message

```
fix(ui): resolve file upload blocked by accordion click interference

Use label+input pattern with stopPropagation to prevent accordion
toggle when clicking upload areas. Ensures file picker opens reliably
for both Start Screen and Stop Screen uploads.

- Add hidden file inputs with unique IDs per task
- Use label[htmlFor] to trigger inputs natively
- Add e.stopPropagation() to prevent event bubbling to accordion
- Reset input value after selection for re-upload support
- Apply same fix to remove buttons

Fixes: Upload areas not responding to clicks
```
