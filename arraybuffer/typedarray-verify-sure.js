/*
for-of chars
  check if B,U,I,F
    failback to unknown -> offset to numbers part
  check endsWith 'ClampedArray' & 'Array'
    failback: false
  check numbers part (starts with 1-9 next 0-9 or omit)
*/