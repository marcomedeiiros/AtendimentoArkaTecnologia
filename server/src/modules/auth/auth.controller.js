const authService = require("./auth.service");
const { success } = require("../../shared/helpers/response.helper");

class AuthController {
  async login(req, res) {
    const data = await authService.login(req.body);
    return success(res, data);
  }

  async me(req, res) {
    const data = await authService.me(req.user.sub);
    return success(res, data);
  }
}

module.exports = new AuthController();
