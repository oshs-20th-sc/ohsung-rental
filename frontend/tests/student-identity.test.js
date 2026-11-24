import assert from "node:assert/strict";
import { test } from "node:test";
import { isStudentAuthEmail, isValidStudentId, studentAuthEmail } from "../src/services/studentIdentity.js";

test("student IDs keep their seven digits, including leading zeroes", () => {
  assert.equal(isValidStudentId("2610710"), true);
  assert.equal(studentAuthEmail("0012345"), "0012345@students.ohsung-rental.invalid");
  assert.equal(isStudentAuthEmail(studentAuthEmail("0012345")), true);
  assert.equal(isStudentAuthEmail("admin@example.test"), false);
});

test("student login rejects non-exact input before a Firebase request", () => {
  for (const value of [2610710, "", "261071", "26107100", "261071a", " 2610710", "2610710\n", "２６１０７１０"]) {
    assert.equal(isValidStudentId(value), false);
    assert.throws(() => studentAuthEmail(value), /숫자 7자리/);
  }
});
