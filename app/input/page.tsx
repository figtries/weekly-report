'use client';

import { useState } from 'react';

export default function InputPage() {
  const [formData, setFormData] = useState({
    week: '',
    spk: '',
    deskripsi: '',
    bobot: '',
    prevProgress: '',
    prevWF: '',
    curProgress: '',
    curWF: '',
    cumProgress: '',
    cumWF: '',
    target: '',
    plan: '',
    actual: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Form submitted:', formData);
    alert('Data saved successfully! (This is a demo - no actual data persistence)');
  };

  return (
    <div className="p-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Data Entry</h1>
        <p className="text-gray-600">Enter or update weekly progress data</p>
      </div>

      {/* Form Card */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 max-w-4xl">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Basic Information Section */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="week" className="block text-sm font-medium text-gray-700 mb-2">
                  Week Number
                </label>
                <input
                  type="number"
                  id="week"
                  name="week"
                  value={formData.week}
                  onChange={handleChange}
                  min="1"
                  max="52"
                  placeholder="e.g., 35"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="spk" className="block text-sm font-medium text-gray-700 mb-2">
                  SPK Number
                </label>
                <select
                  id="spk"
                  name="spk"
                  value={formData.spk}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                >
                  <option value="">Select SPK</option>
                  <option value="SPK001">SPK 001 - Infrastructure Development</option>
                  <option value="SPK002">SPK 002 - Building Construction</option>
                  <option value="SPK003">SPK 003 - MEP Installation</option>
                  <option value="SPK004">SPK 004 - Finishing Works</option>
                </select>
              </div>

              <div>
                <label htmlFor="bobot" className="block text-sm font-medium text-gray-700 mb-2">
                  Bobot (%)
                </label>
                <input
                  type="number"
                  id="bobot"
                  name="bobot"
                  value={formData.bobot}
                  onChange={handleChange}
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g., 25.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="deskripsi" className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                id="deskripsi"
                name="deskripsi"
                value={formData.deskripsi}
                onChange={handleChange}
                rows={2}
                placeholder="Enter SPK description"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              />
            </div>
          </div>

          {/* Progress Metrics Section */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Progress Metrics</h2>
            
            {/* Previous Progress */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                Previous Week
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="prevProgress" className="block text-xs font-medium text-gray-600 mb-2">
                    Progress (%)
                  </label>
                  <input
                    type="number"
                    id="prevProgress"
                    name="prevProgress"
                    value={formData.prevProgress}
                    onChange={handleChange}
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="e.g., 65.50"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label htmlFor="prevWF" className="block text-xs font-medium text-gray-600 mb-2">
                    Weighted Factor (%)
                  </label>
                  <input
                    type="number"
                    id="prevWF"
                    name="prevWF"
                    value={formData.prevWF}
                    onChange={handleChange}
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="e.g., 16.375"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Current Progress */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                Current Week
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="curProgress" className="block text-xs font-medium text-gray-600 mb-2">
                    Progress (%)
                  </label>
                  <input
                    type="number"
                    id="curProgress"
                    name="curProgress"
                    value={formData.curProgress}
                    onChange={handleChange}
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="e.g., 68.20"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label htmlFor="curWF" className="block text-xs font-medium text-gray-600 mb-2">
                    Weighted Factor (%)
                  </label>
                  <input
                    type="number"
                    id="curWF"
                    name="curWF"
                    value={formData.curWF}
                    onChange={handleChange}
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="e.g., 17.05"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Cumulative Progress */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                Cumulative
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cumProgress" className="block text-xs font-medium text-gray-600 mb-2">
                    Progress (%)
                  </label>
                  <input
                    type="number"
                    id="cumProgress"
                    name="cumProgress"
                    value={formData.cumProgress}
                    onChange={handleChange}
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="e.g., 68.20"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label htmlFor="cumWF" className="block text-xs font-medium text-gray-600 mb-2">
                    Weighted Factor (%)
                  </label>
                  <input
                    type="number"
                    id="cumWF"
                    name="cumWF"
                    value={formData.cumWF}
                    onChange={handleChange}
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="e.g., 17.05"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* S-Curve Data Section */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">S-Curve Data</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="plan" className="block text-sm font-medium text-gray-700 mb-2">
                  Plan (%)
                </label>
                <input
                  type="number"
                  id="plan"
                  name="plan"
                  value={formData.plan}
                  onChange={handleChange}
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g., 71.29"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="actual" className="block text-sm font-medium text-gray-700 mb-2">
                  Actual (%)
                </label>
                <input
                  type="number"
                  id="actual"
                  name="actual"
                  value={formData.actual}
                  onChange={handleChange}
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g., 67.19"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Target Section */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Target</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="target" className="block text-sm font-medium text-gray-700 mb-2">
                  Target Progress (%)
                </label>
                <input
                  type="number"
                  id="target"
                  name="target"
                  value={formData.target}
                  onChange={handleChange}
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g., 70.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
              </div>
              <div className="flex items-end">
                <div className="w-full px-4 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">Calculated Variance</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {formData.target && formData.cumProgress
                      ? (parseFloat(formData.cumProgress) - parseFloat(formData.target)).toFixed(2)
                      : '0.00'}
                    %
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-4 border-t border-gray-200 flex gap-3">
            <button
              type="submit"
              className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 shadow-sm"
            >
              Save Data
            </button>
            <button
              type="button"
              onClick={() => {
                setFormData({
                  week: '',
                  spk: '',
                  deskripsi: '',
                  bobot: '',
                  prevProgress: '',
                  prevWF: '',
                  curProgress: '',
                  curWF: '',
                  cumProgress: '',
                  cumWF: '',
                  target: '',
                  plan: '',
                  actual: '',
                });
              }}
              className="px-6 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
            >
              Clear Form
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
