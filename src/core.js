'use strict';

var asap = require('asap/raw');

function noop() { }

// state
//
// 0 - 待处理
// 1 - 已完成 _value
// 2 - 被拒绝，但_value
// 3 - 采用另一个 promise 的状态 _value
//
// 一旦 state 不再为 pending （0），它就是不可变的
// 所有以 '_' 为前缀的属性在构建时都会被简化为 '_{random number}'，以混淆它们并阻止使用它们。
// 我们不使用元件或 Object.defineProperty 来完全隐藏它们，因为性能不够好。
// 为了避免在关键函数中使用 try/catch，我们
// 将它们提取到此处。


var LAST_ERROR = null;
var IS_ERROR = {};





/**
 * 从给定对象中检索 'then' 属性。
 * 如果在检索过程中发生异常，它会将 LAST_ERROR 变量设置为异常并返回 IS_ERROR。
 * @param {object} obj - 要从中检索 'then' 属性的对象。
 * @returns 对象的 'then' 属性，如果发生异常，则为 IS_ERROR。
 */
function getThen(obj) {
  try {
    return obj.then;
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}




// tryCallOne -> fn

/**
 * 使用一个参数调用函数并处理发生的任何异常。
 * @param {Function} fn - 要调用的函数。
 * @param {any} a - 要传递给函数的参数。
 * @returns 使用参数调用函数的结果，如果发生异常，则IS_ERROR。
 */
function tryCallOne(fn, a) {
  try {
    return fn(a);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}



// tryCallTwo -> fn

/**
 * 尝试调用具有两个参数的函数并捕获发生的任何异常。
 * 如果捕获到异常，它会将 LAST_ERROR 变量设置为异常并返回 IS_ERROR。
 * @param {Function} fn - 要调用的函数。
 * @param {any} a - 要传递给函数的第一个参数。
 * @param {any} b - 要传递给函数的第二个参数。
 * @returns IS_ERROR 如果捕获到异常，否则 undefined。
 */
function tryCallTwo(fn, a, b) {
  try {
    fn(a, b);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}








// -----------------------------------------  Promise class -------------------------------------


module.exports = Promise;





// ----------------------------------------- constructor -------------------------------------




// promise -> doResolve


/**
 * 自定义 Promise 构造函数，用于初始化新的 Promise 对象。
 * @param {function} fn - 创建 Promise 时将执行的函数。
 * @throws {TypeError} 如果 Promise 不是通过 'new' 构造的，或者参数不是函数。
 * @returns 无
 */
function Promise(fn) {
  // 检查是否通过 'new' 关键字创建 Promise 实例
  if (typeof this !== 'object') {
    throw new TypeError('Promises must be constructed via new');
  }
  // 检查传入的参数是否为函数
  if (typeof fn !== 'function') {
    throw new TypeError('Promise constructor\'s argument is not a function');
  }


  // 初始化 Promise 的状态


  //! 初始化延迟状态变量，用于处理异步逻辑
  this._deferredState = 0;
  //! 初始化状态变量，用于表示当前状态
  this._state = 0;
  //! 初始化值变量，用于存储异步操作的结果
  this._value = null;
  //! 初始化延迟对象数组，用于存储等待执行的回调函数
  this._deferreds = null;

  // 如果 fn 是空函数，则直接返回，不做进一步操作
  if (fn === noop) return;


  // ! 开始执行传入的 fn 函数，并传递当前 Promise 实例给 doResolve 函数
  //! 初始化 resolve  ， reject 方法
  doResolve(fn, this);
}






// ----------------------------------------- static -------------------------------------




Promise._onHandle = null;
Promise._onReject = null;
Promise._noop = noop;






// ------------------------------------------ prototype ---------------------------------------------



// then ->  safeThen  /  handle


/**
 * 扩展 Promise.prototype.then 方法的功能，以处理 Promise 构造函数不是标准 Promise 的情况。它创建一个新的 Promise 并处理原始 Promise 的 fulfillment 或 rejection。
 * @param {Function} onFulfilled - 履行 Promise 时要执行的函数。
 * @param {Function} onRejected - 当 Promise 被拒绝时要执行的函数。
 * @returns 一个新的 Promise 对象，它基于原始 Promise 解析或拒绝。
 */
Promise.prototype.then = function (onFulfilled, onRejected) {
  if (this.constructor !== Promise) {
    return safeThen(this, onFulfilled, onRejected);
  }

  var res = new Promise(noop);

  handle(this, new Handler(onFulfilled, onRejected, res));

  return res;

};



// ------------------------------------------ prototype helpers ---------------------------------------------




// safeThen  -> self.constructor  -> res.then  /  handle


/**
 * 创建一个新 Promise，该 Promise 根据原始 Promise 的结果进行 resolves 或 reject。
 * @param {Object} self - 承诺对象。
 * @param {Function} onFulfilled - 履行 Promise 时要执行的函数。
 * @param {Function} onRejected - 当 Promise 被拒绝时要执行的函数。
 * @returns 根据原始 Promise 解决或拒绝的新 Promise。
 */
function safeThen(self, onFulfilled, onRejected) {
  return new self.constructor(function (resolve, reject) {
    var res = new Promise(noop);
    res.then(resolve, reject);
    handle(self, new Handler(onFulfilled, onRejected, res));
  });
}






// handle ->  Promise._onHandle  /  handleResolved

/**
 * 通过更新 Promise 的状态和处理延迟的操作来处理 Promise 的解析。
 * @param {Promise} self - 要处理的 promise 对象。
 * @param {any} deferred - 要处理的延迟操作。
 * @returns 无
 */
function handle(self, deferred) {
  // 当 promise 的状态为等待时，递归地处理直到状态变为已解析或已拒绝
  while (self._state === 3) {
    self = self._value;
  }
  // 如果存在处理函数，调用该处理函数
  if (Promise._onHandle) {
    Promise._onHandle(self);
  }
  // 如果 promise 的状态为挂起（未解析）
  if (self._state === 0) {
    // 如果延迟操作的状态为未设置，则设置为已设置
    if (self._deferredState === 0) {
      self._deferredState = 1;
      self._deferreds = deferred;
      return;
    }
    // 如果延迟操作的状态为已设置，但延迟操作为空，则将当前延迟操作设置为空
    if (self._deferredState === 1) {
      self._deferredState = 2;
      self._deferreds = [self._deferreds, deferred];
      return;
    }
    // 将当前延迟操作添加到延迟操作列表中
    self._deferreds.push(deferred);
    return;
  }
  // 调用已解析的处理函数
  handleResolved(self, deferred);
}









// handleResolved  -> asap -> resolve /  reject  / tryCallOne 

/**
 * 通过执行适当的回调函数来处理 Promise 的 resolved 状态。
 * @param {Object} self - 承诺对象。
 * @param {Object} deferred - 包含 onFulfilled 和 onRejected 回调的延迟对象。
 * @returns 无
 */
function handleResolved(self, deferred) {
  // 立即异步执行函数
  asap(function () {
    // 根据 self 的状态选择合适的回调函数
    var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;
    // 如果回调函数为 null，则根据 self 的状态直接 resolve 或 reject deferred 的 promise
    if (cb === null) {
      if (self._state === 1) {
        resolve(deferred.promise, self._value);
      } else {
        reject(deferred.promise, self._value);
      }
      return;
    }
    // 尝试执行回调函数，并获取返回值
    var ret = tryCallOne(cb, self._value);
    // 如果回调函数执行出错，则 reject deferred 的 promise
    if (ret === IS_ERROR) {
      reject(deferred.promise, LAST_ERROR);
    } else {
      // 否则，根据回调函数的返回值 resolve deferred 的 promise
      resolve(deferred.promise, ret);
    }
  });
}


// resolve ->  reject  /  getThen  /  finale  / doResolve

/**
 * 解析具有给定值的 Promise。
 * @param {Promise} self - 要解析的 promise 对象。
 * @param {any} newValue - 用于解析 Promise 的值。
 * @returns 无
 */
function resolve(self, newValue) {
  // Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure

  // 检查newValue是否为self，防止循环引用。
  if (newValue === self) {
    return reject(
      self,
      new TypeError('A promise cannot be resolved with itself.')
    );
  }

  // 检查newValue是否为非空对象或函数。
  if (
    newValue &&
    (typeof newValue === 'object' || typeof newValue === 'function')
  ) {

    // 获取newValue的then方法。
    var then = getThen(newValue);

    // 如果获取then方法时发生错误，返回错误。
    if (then === IS_ERROR) {
      return reject(self, LAST_ERROR);
    }

    // 检查newValue的then方法是否为当前Promise的then方法，且newValue是否为Promise实例。
    if (
      then === self.then &&
      newValue instanceof Promise
    ) {

      // 将当前Promise的状态设置为等待状态，并将newValue赋值给当前Promise。
      self._state = 3;
      self._value = newValue;
      // 执行终结函数。
      finale(self);
      return;

    } else if (typeof then === 'function') {

      // 如果then是一个函数，通过doResolve来处理。
      doResolve(then.bind(newValue), self);
      return;
    }
  }

  // 如果newValue不是对象或函数，或者没有then方法，将当前Promise解析为fulfilled状态。

  self._state = 1;
  self._value = newValue;

  // 执行终结函数。
  finale(self);
}






// reject ->  Promise._onReject  /  finale


/**
 * 将 Promise 的状态更新为 rejected 并将值设置为提供的新值。
 * 调用 onReject 处理程序（如果已定义），然后调用 finale 函数。
 * @param {Promise} self - 要更新的 Promise 对象。
 * @param {any} newValue - 要为 Promise 设置的新值。
 * @returns 无
 */
function reject(self, newValue) {
  self._state = 2;
  self._value = newValue;
  if (Promise._onReject) {
    Promise._onReject(self, newValue);
  }
  finale(self);
}






// finale -> handle

/**
 * 通过执行适当的回调来处理 promise 的解析。
 * @param {Object} self - 承诺对象。
 * @returns 无
 */
function finale(self) {
  // 如果 promise 处于解析状态，执行相应的回调并清除回调列表
  if (self._deferredState === 1) {
    handle(self, self._deferreds);
    self._deferreds = null;
  }
   // 如果 promise 处于拒绝状态，遍历并执行所有拒绝回调，然后清除回调列表
  if (self._deferredState === 2) {
    for (var i = 0; i < self._deferreds.length; i++) {
      handle(self, self._deferreds[i]);
    }
    self._deferreds = null;
  }
}


















/**
 * 表示 Promise 的处理程序，其中包含在 Promise 实现或拒绝时要执行的函数。
 * @param {Function} onFulfilled - 履行 Promise 时要执行的函数。
 * @param {Function} onRejected - 当 Promise 被拒绝时要执行的函数。
 * @param {Promise} promise - 与此处理程序关联的 promise。
 */
function Handler(onFulfilled, onRejected, promise) {
  // 将履行函数存储在实例中，如果提供的履行参数不是函数，则设置为null。
  this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
  // 将拒绝函数存储在实例中，如果提供的拒绝参数不是函数，则设置为null。
  this.onRejected = typeof onRejected === 'function' ? onRejected : null;
  // 将关联的 Promise 实例存储在实例中。
  this.promise = promise;
}
















// doResolve -> tryCallTwo -> 解决 / 拒绝
/**
 * 采用可能行为异常的解析程序函数，并确保 onFulfilled 和 onRejected 仅调用一次。
 *
 * 不保证异步。
 */
/**
 * 执行提供的函数来解析 Promise，处理成功和错误情况。
 * @param {Function} fn - 为解析 Promise 而执行的函数。
 * @param {Promise} promise - 要解决的承诺。
 * @returns 无
 */
function doResolve(fn, promise) {
  // 标记是否已经处理过 promise 
  var done = false;


  // 尝试执行 fn，并分别处理成功和失败的情况
  var res = tryCallTwo(fn,

    //! 代理 回调 resolve 方法
    function (value) {
      if (done) return;
      done = true;

      resolve(promise, value);
    },

    //! 代理 回调 reject 方法
    function (reason) {
      if (done) return;
      done = true;

      reject(promise, reason);
    });



  // 如果 fn 执行时没有处理过 promise 且发生了错误，则拒绝 promise
  if (!done && res === IS_ERROR) {
    done = true;
    reject(promise, LAST_ERROR);
  }
}


