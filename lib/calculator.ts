export function safeCalculate(expression: string) {
  const source = expression.replace(/,/g, '').trim()
  if (!source || source.length > 200) throw new Error('Invalid calculation.')
  if (!/^[0-9+\-*/().%\s]+$/.test(source)) throw new Error('Only basic arithmetic is supported.')

  let index = 0

  function skip() {
    while (/\s/.test(source[index] || '')) index += 1
  }

  function number() {
    skip()
    const start = index
    while (/[0-9.]/.test(source[index] || '')) index += 1
    const value = Number(source.slice(start, index))
    if (!Number.isFinite(value)) throw new Error('Invalid number.')
    return value
  }

  function factor(): number {
    skip()
    if (source[index] === '+') {
      index += 1
      return factor()
    }
    if (source[index] === '-') {
      index += 1
      return -factor()
    }
    if (source[index] === '(') {
      index += 1
      const value = addSub()
      skip()
      if (source[index] !== ')') throw new Error('Missing closing parenthesis.')
      index += 1
      return value
    }
    return number()
  }

  function mulDiv(): number {
    let value = factor()
    while (true) {
      skip()
      const op = source[index]
      if (op !== '*' && op !== '/' && op !== '%') return value
      index += 1
      const right = factor()
      if ((op === '/' || op === '%') && right === 0) throw new Error('Cannot divide by zero.')
      value = op === '*' ? value * right : op === '/' ? value / right : value % right
      if (!Number.isFinite(value)) throw new Error('Result is not finite.')
    }
  }

  function addSub(): number {
    let value = mulDiv()
    while (true) {
      skip()
      const op = source[index]
      if (op !== '+' && op !== '-') return value
      index += 1
      const right = mulDiv()
      value = op === '+' ? value + right : value - right
      if (!Number.isFinite(value)) throw new Error('Result is not finite.')
    }
  }

  const result = addSub()
  skip()
  if (index !== source.length) throw new Error('Invalid calculation.')
  return String(result)
}
