import isPlainObject from './isPlainObject'
import { Middleware } from 'redux'
import { getTimeMeasureUtils } from './utils'

/**
 * Returns true if the passed value is "plain", i.e. a value that is either
 * directly JSON-serializable (boolean, number, string, array, plain object)
 * or `undefined`.
 *
 * @param val The value to check.
 *
 * @public
 */
export function isPlain(val: any) {
  return (
    typeof val === 'undefined' ||
    val === null ||
    typeof val === 'string' ||
    typeof val === 'boolean' ||
    typeof val === 'number' ||
    Array.isArray(val) ||
    isPlainObject(val)
  )
}

interface NonSerializableValue {
  keyPath: string
  value: unknown
}

/**
 * @public
 */
export function findNonSerializableValue(
  value: unknown,
  path: ReadonlyArray<string> = [],
  isSerializable: (value: unknown) => boolean = isPlain,
  getEntries?: (value: unknown) => [string, any][],
  ignoredPaths: string[] = []
): NonSerializableValue | false {
  let foundNestedSerializable: NonSerializableValue | false

  if (!isSerializable(value)) {
    return {
      keyPath: path.join('.') || '<root>',
      value: value
    }
  }

  if (typeof value !== 'object' || value === null) {
    return false
  }

  const entries = getEntries != null ? getEntries(value) : Object.entries(value)

  const hasIgnoredPaths = ignoredPaths.length > 0

  for (const [property, nestedValue] of entries) {
    const nestedPath = path.concat(property)

    if (hasIgnoredPaths && ignoredPaths.indexOf(nestedPath.join('.')) >= 0) {
      continue
    }

    if (!isSerializable(nestedValue)) {
      return {
        keyPath: nestedPath.join('.'),
        value: nestedValue
      }
    }

    if (typeof nestedValue === 'object') {
      foundNestedSerializable = findNonSerializableValue(
        nestedValue,
        nestedPath,
        isSerializable,
        getEntries,
        ignoredPaths
      )

      if (foundNestedSerializable) {
        return foundNestedSerializable
      }
    }
  }

  return false
}

/**
 * Options for `createSerializableStateInvariantMiddleware()`.
 *
 * @public
 */
export interface SerializableStateInvariantMiddlewareOptions {
  /**
   * The function to check if a value is considered serializable. This
   * function is applied recursively to every value contained in the
   * state. Defaults to `isPlain()`.
   */
  isSerializable?: (value: any) => boolean
  /**
   * The function that will be used to retrieve entries from each
   * value.  If unspecified, `Object.entries` will be used. Defaults
   * to `undefined`.
   */
  getEntries?: (value: any) => [string, any][]

  /**
   * An array of action types to ignore when checking for serializability, Defaults to []
   */
  ignoredActions?: string[]

  /**
   * An array of dot-separated path strings to ignore when checking for serializability, Defaults to ['meta.arg']
   */
  ignoredActionPaths?: string[]

  /**
   * An array of dot-separated path strings to ignore when checking for serializability, Defaults to []
   */
  ignoredPaths?: string[]
  /**
   * Execution time warning threshold. If the middleware takes longer than `warnAfter` ms, a warning will be displayed in the console. Defaults to 32
   */
  warnAfter?: number
}

/**
 * Creates a middleware that, after every state change, checks if the new
 * state is serializable. If a non-serializable value is found within the
 * state, an error is printed to the console.
 *
 * @param options Middleware options.
 *
 * @public
 */
export function createSerializableStateInvariantMiddleware(
  options: SerializableStateInvariantMiddlewareOptions = {}
): Middleware {
  if (process.env.NODE_ENV === 'production') {
    return () => next => action => next(action)
  }
  const {
    isSerializable = isPlain,
    getEntries,
    ignoredActions = [],
    ignoredActionPaths = ['meta.arg'],
    ignoredPaths = [],
    warnAfter = 32
  } = options

  return storeAPI => next => action => {
    if (ignoredActions.length && ignoredActions.indexOf(action.type) !== -1) {
      return next(action)
    }

    const measureUtils = getTimeMeasureUtils(
      warnAfter,
      'SerializableStateInvariantMiddleware'
    )
    measureUtils.measureTime(() => {
      const foundActionNonSerializableValue = findNonSerializableValue(
        action,
        [],
        isSerializable,
        getEntries,
        ignoredActionPaths
      )

      if (foundActionNonSerializableValue) {
        const { keyPath, value } = foundActionNonSerializableValue

        console.error(
          `A non-serializable value was detected in an action, in the path: \`${keyPath}\`. Value:`,
          value,
          '\nTake a look at the logic that dispatched this action: ',
          action,
          '\n(See https://redux.js.org/faq/actions#why-should-type-be-a-string-or-at-least-serializable-why-should-my-action-types-be-constants)',
          '\n(To allow non-serializable values see: https://redux-toolkit.js.org/usage/usage-guide#working-with-non-serializable-data)'
        )
      }
    })

    const result = next(action)

    measureUtils.measureTime(() => {
      const state = storeAPI.getState()

      const foundStateNonSerializableValue = findNonSerializableValue(
        state,
        [],
        isSerializable,
        getEntries,
        ignoredPaths
      )

      if (foundStateNonSerializableValue) {
        const { keyPath, value } = foundStateNonSerializableValue

        console.error(
          `A non-serializable value was detected in the state, in the path: \`${keyPath}\`. Value:`,
          value,
          `
Take a look at the reducer(s) handling this action type: ${action.type}.
(See https://redux.js.org/faq/organizing-state#can-i-put-functions-promises-or-other-non-serializable-items-in-my-store-state)`
        )
      }
    })

    measureUtils.warnIfExceeded()

    return result
  }
}
