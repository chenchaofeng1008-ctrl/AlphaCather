const form = document.querySelector("#calculator-form")
const resultPanel = document.querySelector("#result-panel")
const rentResults = document.querySelectorAll(".rent-result")
const rentTip = document.querySelector("#rent-tip")
const interpretation = document.querySelector("#interpretation")

form.addEventListener("submit", (event) => {
  event.preventDefault()

  const values = parseInputs(new FormData(form))
  const errors = validateInputs(values)
  renderErrors(errors)

  if (Object.keys(errors).length > 0) {
    resultPanel.hidden = true
    return
  }

  renderResult(calculateResult(values))
})

function parseInputs(formData) {
  const monthlyRentRaw = formData.get("monthlyRent")

  return {
    housePriceWan: toNumber(formData.get("housePriceWan")),
    downPaymentRate: toNumber(formData.get("downPaymentRate")),
    annualRate: toNumber(formData.get("annualRate")),
    loanYears: toNumber(formData.get("loanYears")),
    monthlyRent: monthlyRentRaw === "" ? null : toNumber(monthlyRentRaw)
  }
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return NaN
  }

  return Number(value)
}

function validateInputs(values) {
  const errors = {}

  if (!Number.isFinite(values.housePriceWan) || values.housePriceWan <= 0) {
    errors.housePriceWan = "请输入大于 0 的房屋总价"
  }

  if (
    !Number.isFinite(values.downPaymentRate) ||
    values.downPaymentRate < 0 ||
    values.downPaymentRate > 100
  ) {
    errors.downPaymentRate = "请输入 0 到 100 之间的首付比例"
  }

  if (!Number.isFinite(values.annualRate) || values.annualRate < 0) {
    errors.annualRate = "请输入不小于 0 的贷款年利率"
  }

  if (
    !Number.isFinite(values.loanYears) ||
    values.loanYears < 1 ||
    values.loanYears > 30
  ) {
    errors.loanYears = "请输入 1 到 30 年的贷款年限"
  }

  if (values.monthlyRent !== null && (!Number.isFinite(values.monthlyRent) || values.monthlyRent < 0)) {
    errors.monthlyRent = "月租金不能小于 0"
  }

  return errors
}

function calculateResult(values) {
  const housePriceYuan = values.housePriceWan * 10000
  const downPayment = housePriceYuan * values.downPaymentRate / 100
  const loanAmount = Math.max(housePriceYuan - downPayment, 0)
  const totalMonths = values.loanYears * 12
  const monthlyRate = values.annualRate / 100 / 12
  const monthlyPayment = calculateMonthlyPayment(loanAmount, monthlyRate, totalMonths)
  const totalCostYuan = downPayment + monthlyPayment * totalMonths
  const hasRentResult = values.monthlyRent !== null && values.monthlyRent > 0
  const result = {
    monthlyPayment,
    totalCostYuan,
    hasRentResult,
    rentalYield: null,
    paybackYears: null,
    interpretation: ""
  }

  if (hasRentResult) {
    const annualRent = values.monthlyRent * 12
    result.rentalYield = annualRent / totalCostYuan * 100
    result.paybackYears = totalCostYuan / annualRent
    result.interpretation = getInterpretation(result.paybackYears)
  }

  return result
}

function calculateMonthlyPayment(loanAmount, monthlyRate, totalMonths) {
  if (loanAmount <= 0) {
    return 0
  }

  if (monthlyRate === 0) {
    return loanAmount / totalMonths
  }

  const factor = Math.pow(1 + monthlyRate, totalMonths)
  return loanAmount * monthlyRate * factor / (factor - 1)
}

function getInterpretation(paybackYears) {
  if (paybackYears <= 25) {
    return "回本周期相对较短，租金覆盖能力较好。"
  }

  if (paybackYears <= 40) {
    return "回本周期处于中等水平，可结合空置、维护和税费继续评估。"
  }

  return "回本周期较长，租金收益对总投入的覆盖较弱。"
}

function renderErrors(errors) {
  document.querySelectorAll("[data-error-for]").forEach((element) => {
    element.textContent = errors[element.dataset.errorFor] || ""
  })
}

function renderResult(result) {
  document.querySelector("#monthlyPayment").textContent = Math.round(result.monthlyPayment).toLocaleString()
  document.querySelector("#totalCostWan").textContent = (result.totalCostYuan / 10000).toFixed(2)

  resultPanel.hidden = false
  rentResults.forEach((element) => {
    element.hidden = !result.hasRentResult
  })
  rentTip.hidden = result.hasRentResult
  interpretation.hidden = !result.hasRentResult

  if (result.hasRentResult) {
    document.querySelector("#rentalYield").textContent = result.rentalYield.toFixed(1)
    document.querySelector("#paybackYears").textContent = result.paybackYears.toFixed(1)
    interpretation.textContent = result.interpretation
  }
}
